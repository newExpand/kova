import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { useTmuxStore } from "../../tmux/stores/tmuxStore";
import * as commands from "../../../lib/tauri/commands";
import type { TerminalConfig, PaneAction } from "../types";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "tauri-pty";
import { getThemeById, applyOpacityToTheme } from "../themes";
import { getFontById, loadFontCss } from "../fonts";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
// Direct import to avoid circular chunk dependency (terminal ↔ settings)
import { useSettingsStore } from "../../settings/stores/settingsStore";
import { createFilePathLinkProvider } from "../links/filePathLinkProvider";
import { createUrlLinkProvider } from "../links/urlLinkProvider";

// Replicate macOS Terminal.app / iTerm2 behavior: escape shell special characters
function escapeShellPath(path: string): string {
  if (/[ '"\\$`!#&|;(){}]/.test(path)) {
    return "'" + path.replace(/'/g, "'\\''") + "'";
  }
  return path;
}

// Parse the button code from an xterm mouse escape sequence, stripping modifier bits.
// Returns the masked code (e.g. 0-3=button, 32-35=motion, 64+=scroll) or null.
// SGR mode (1006): \x1b[<Pb;Px;PyM (press/motion) or \x1b[<Pb;Px;Pym (release)
// Normal mode (1000): \x1b[M followed by 3 raw bytes (each value + 32)
// Button code bits: 0-1=button, 2=shift, 3=meta, 4=ctrl, 5=motion(32), 6=scroll(64), 7=extended(128)
const MOUSE_MODIFIER_MASK = ~(4 | 8 | 16); // strip shift, meta, ctrl bits

// Attempt a PTY resize. Expected to fail when PTY has already exited (post-sleep, etc.).
// Unexpected errors (IPC failures, invalid dimensions) are logged for debugging.
function safePtyResize(pty: IPty, cols: number, rows: number): void {
  try {
    pty.resize(cols, rows);
  } catch (e) {
    if (e instanceof Error && !e.message.includes("exit")) {
      console.warn("[useTerminal] Unexpected PTY resize error:", e);
    }
  }
}

function parseMouseButtonCode(data: string): number | null {
  if (data.length < 6) return null;
  if (data[0] !== '\x1b' || data[1] !== '[') return null;

  const mode = data[2];

  // SGR mouse mode: \x1b[< ...
  if (mode === '<') {
    const semiIdx = data.indexOf(";", 3);
    if (semiIdx > 3) {
      const raw = data.substring(3, semiIdx);
      if (/^\d+$/.test(raw)) return parseInt(raw, 10) & MOUSE_MODIFIER_MASK;
    }
    return null;
  }

  // Normal mouse mode: \x1b[M ...
  if (mode === 'M') {
    const raw = data.charCodeAt(3);
    if (raw < 32) return null; // invalid: raw byte must be >= 32 per xterm protocol
    return (raw - 32) & MOUSE_MODIFIER_MASK;
  }

  return null;
}

// Detect mouse event escape sequences (click, release, motion) from xterm.js onData.
// Returns true for button/motion events (codes 0-63), false for scroll (64+) and non-mouse data.
function isMouseClickEscapeSequence(data: string): boolean {
  const code = parseMouseButtonCode(data);
  return code !== null && code < 64;
}

// Detect mouse DRAG MOTION escape sequences specifically (bit 5 = 32).
// Returns true only for motion events (codes 32-35), not for press/release/scroll.
// Used to suppress micro-drag motion that would cause tmux to enter copy-mode.
function isMouseDragMotionSequence(data: string): boolean {
  const code = parseMouseButtonCode(data);
  return code !== null && (code & 32) !== 0 && code < 64;
}

// Detect SGR mouse release: \x1b[<Pb;Px;Pym (lowercase 'm' terminator).
function isSgrMouseRelease(data: string): boolean {
  return data.length >= 6 && data[0] === '\x1b' && data[1] === '['
    && data[2] === '<' && data.endsWith('m');
}

// Build a synthetic motion event one column past the release position.
// tmux copy-mode uses exclusive-end: cursor position is excluded from the
// copied text. Injecting motion at col+1 moves the cursor past the last
// desired character so copy-selection includes it.
// Only converts left-button (code & 3 === 0) releases.
function sgrReleaseToMotionPlusOne(data: string): string | null {
  const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)m$/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  const rawCode = parseInt(match[1], 10);
  if ((rawCode & 3) !== 0) return null;
  const col = parseInt(match[2], 10) + 1;
  return `\x1b[<${rawCode | 32};${col};${match[3]}M`;
}

// Extract column and row from an SGR mouse escape sequence.
function parseSgrPos(data: string): { col: number; row: number } | null {
  const match = data.match(/^\x1b\[<\d+;(\d+);(\d+)/);
  if (!match || !match[1] || !match[2]) return null;
  return { col: parseInt(match[1], 10), row: parseInt(match[2], 10) };
}

interface UseTerminalOptions {
  onDragState?: (isDragging: boolean) => void;
  onRequestPaneAction?: (action: PaneAction) => void;
  onPtySpawn?: (pid: number) => void;
  isActive?: boolean;
}

interface UseTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  connect: (config: TerminalConfig) => Promise<void>;
  disconnect: () => void;
  refit: () => void;
}

export function useTerminal(options?: UseTerminalOptions): UseTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);

  const unlistenRef = useRef<(() => void) | null>(null);
  const themeUnsubRef = useRef<(() => void) | null>(null);
  // Keep latest callback ref so drag-drop listener always uses current handler
  const onDragStateRef = useRef(options?.onDragState);
  onDragStateRef.current = options?.onDragState;
  const onRequestPaneActionRef = useRef(options?.onRequestPaneAction);
  onRequestPaneActionRef.current = options?.onRequestPaneAction;
  const onPtySpawnRef = useRef(options?.onPtySpawn);
  onPtySpawnRef.current = options?.onPtySpawn;
  // Track active state so drag-drop handler only fires for the visible terminal
  const isActiveRef = useRef(options?.isActive ?? false);
  isActiveRef.current = options?.isActive ?? false;
  // Guard flag — prevents writes/kills after PTY has exited
  const aliveRef = useRef(false);
  // Track current projectId for disconnect() — set during connect()
  const projectIdRef = useRef<string | null>(null);
  // Monotonic counter — each connect() call gets a unique ID.
  // Stale async continuations check this to bail out.
  const connectIdRef = useRef(0);
  // setTimeout refs for cleanup
  const initialCmdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tier1TimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tier2TimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drag-distance tracking: prevent accidental clipboard copy on micro-drags.
  // Uses time + distance composite condition: mousedown must be held for at least
  // DRAG_TIME_THRESHOLD_MS (150ms) AND moved beyond DRAG_THRESHOLD_PX (5px).
  // Shared between DOM listeners (mousedown/mousemove) and OSC 52 handler.
  const dragDistanceRef = useRef({ exceeded: false, startX: 0, startY: 0, startTime: 0 });
  const dragListenersRef = useRef<{ cleanup: () => void } | null>(null);
  const linkProviderDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const urlLinkProviderDisposableRef = useRef<{ dispose: () => void } | null>(null);
  // True while mouse hovers a file path link. Suppresses mouse click escape
  // sequences in onData so tmux copy-mode isn't canceled on link click.
  const linkHoverRef = useRef(false);
  const linkHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track active TerminalConfig for wake handler (needs SSH mode check)
  const configRef = useRef<TerminalConfig | null>(null);
  // Timeout for resize restore after wake probe
  const wakeResizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    // Mark dead FIRST so callbacks stop writing
    aliveRef.current = false;
    // Bump connect ID so any in-flight connect() bails out
    connectIdRef.current += 1;

    // Clear pending timeouts
    if (initialCmdTimeoutRef.current) {
      clearTimeout(initialCmdTimeoutRef.current);
      initialCmdTimeoutRef.current = null;
    }
    if (refitTimeoutRef.current) {
      clearTimeout(refitTimeoutRef.current);
      refitTimeoutRef.current = null;
    }
    if (tier1TimeoutRef.current) {
      clearTimeout(tier1TimeoutRef.current);
      tier1TimeoutRef.current = null;
    }
    if (tier2TimeoutRef.current) {
      clearTimeout(tier2TimeoutRef.current);
      tier2TimeoutRef.current = null;
    }
    if (clipboardToastTimeoutRef.current) {
      clearTimeout(clipboardToastTimeoutRef.current);
      clipboardToastTimeoutRef.current = null;
    }
    if (wakeResizeTimeoutRef.current) {
      clearTimeout(wakeResizeTimeoutRef.current);
      wakeResizeTimeoutRef.current = null;
    }
    configRef.current = null;

    // Unsubscribe from theme changes
    if (themeUnsubRef.current) {
      themeUnsubRef.current();
      themeUnsubRef.current = null;
    }

    // Remove drag-distance tracking listeners
    if (dragListenersRef.current) {
      dragListenersRef.current.cleanup();
      dragListenersRef.current = null;
    }

    // Dispose file path link provider
    if (linkProviderDisposableRef.current) {
      try { linkProviderDisposableRef.current.dispose(); } catch { /* already disposed */ }
      linkProviderDisposableRef.current = null;
    }
    // Dispose URL link provider
    if (urlLinkProviderDisposableRef.current) {
      try { urlLinkProviderDisposableRef.current.dispose(); } catch { /* already disposed */ }
      urlLinkProviderDisposableRef.current = null;
    }
    linkHoverRef.current = false;
    if (linkHoverTimeoutRef.current) {
      clearTimeout(linkHoverTimeoutRef.current);
      linkHoverTimeoutRef.current = null;
    }

    // Unregister Tauri drag-drop listener
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitAddonRef.current = null;
    // Kill PTY LAST — it may already be dead, that's fine.
    // After Phase 3 slave fd fix, kill() → SIGHUP → child dies → slave fd
    // closes → read() gets EOF → readData() exits cleanly. No pid poisoning needed.
    if (ptyRef.current) {
      const pty = ptyRef.current;
      ptyRef.current = null;
      try {
        const pid = (pty as unknown as { pid?: number }).pid;
        if (pid != null && pid >= 0) {
          commands.killPty(pid).catch((err) => {
            const msg = String(err);
            if (!msg.includes("Unavailable pid") && !msg.includes("No such process")) {
              console.warn("[useTerminal] Unexpected PTY kill error:", err);
            }
          });
        }
      } catch {
        // PTY already disposed
      }
    }
  }, []);

  const connect = useCallback(
    async (config: TerminalConfig) => {
      // Clean up any existing connection
      cleanup();
      // Track projectId for disconnect()
      projectIdRef.current = config.projectId;
      // Track config for wake handler (SSH mode check + resize)
      configRef.current = config;
      // Capture this connection's ID — if it changes, we're stale
      const myId = connectIdRef.current;
      const isStale = () => connectIdRef.current !== myId;

      useTerminalStore.getState().setStatus(config.projectId, "connecting");
      useTerminalStore.getState().setSession(config.projectId, config.sessionName);

      try {
        // Dynamic imports to keep xterm.js in separate chunk
        const [{ Terminal }, { FitAddon }, { Unicode11Addon }, { WebFontsAddon, loadFonts: xtermLoadFonts }] =
          await Promise.all([
            import("@xterm/xterm"),
            import("@xterm/addon-fit"),
            import("@xterm/addon-unicode11"),
            import("@xterm/addon-web-fonts"),
          ]);
        if (isStale()) return;

        const container = containerRef.current;
        if (!container) {
          useTerminalStore.getState().setError(config.projectId, "Terminal container not found");
          return;
        }

        // Create terminal instance
        const currentTheme = getThemeById(
          useSettingsStore.getState().terminalTheme,
        );
        const { terminalOpacity, terminalFontFamily, terminalFontSize } = useSettingsStore.getState();
        const fontPreset = getFontById(terminalFontFamily);

        // Step 1: Load @font-face CSS for web fonts (registers in document.fonts)
        await loadFontCss(fontPreset);
        if (isStale()) return;

        const term = new Terminal({
          fontSize: terminalFontSize,
          fontFamily: fontPreset.fontFamily,
          theme: applyOpacityToTheme(currentTheme.xterm, terminalOpacity),
          cursorBlink: true,
          convertEol: false,
          allowProposedApi: true,
          allowTransparency: true,
          scrollback: 0,
          macOptionClickForcesSelection: true,
          minimumContrastRatio: 3,
        });

        // Load addons
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        // Unicode11 — correct double-width for Korean/CJK/emoji
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
        // WebFontsAddon — ensures xterm canvas renderer picks up web fonts
        const webFontsAddon = new WebFontsAddon();
        term.loadAddon(webFontsAddon);

        // OSC 52 clipboard handler — tmux sends this when mouse-selected text
        // is copied with set-clipboard on.
        // Format: OSC 52 ; <selection> ; <base64-data> ST
        term.parser.registerOscHandler(52, (data: string) => {
          const idx = data.indexOf(";");
          if (idx < 0) return false;
          const payload = data.slice(idx + 1);
          if (payload === "?") return true; // clipboard query — ignore
          try {
            // Skip clipboard write if mouse drag distance was below threshold
            // (user likely intended a click, not a selection).
            if (!dragDistanceRef.current.exceeded) return true;
            // Decode base64 with proper UTF-8 handling (Korean/CJK/emoji)
            const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
            const text = new TextDecoder().decode(bytes);
            // Skip empty/whitespace-only selections
            if (!text.trim()) return true;
            writeText(text)
              .then(() => showClipboardToast())
              .catch((err) =>
                console.error("[OSC 52] clipboard write failed:", err),
              );
          } catch (err) {
            // atob() throws DOMException for invalid base64 — expected for non-OSC52 data.
            if (!(err instanceof DOMException)) {
              console.warn("[OSC 52] Unexpected error processing clipboard data:", err);
            }
          }
          return true;
        });

        // Step 2: Wait for xterm to load the actual font glyphs BEFORE open()
        // System fonts won't be in document.fonts, so we catch the rejection.
        if (fontPreset.category === "popular") {
          try {
            await webFontsAddon.loadFonts([fontPreset.name]);
          } catch {
            // Font not found in document.fonts — fallback to monospace
          }
        }
        if (isStale()) {
          term.dispose();
          return;
        }

        // Verify container is in the DOM and has non-zero dimensions.
        // During rapid project switching, the container might not have
        // been laid out yet when connect() reaches this point.
        if (!container.isConnected) {
          term.dispose();
          useTerminalStore.getState().setError(config.projectId, "Terminal container detached from DOM");
          return;
        }
        let dimAttempts = 0;
        while ((container.clientWidth === 0 || container.clientHeight === 0) && dimAttempts < 20) {
          dimAttempts++;
          await new Promise((r) => setTimeout(r, 50));
          if (isStale()) { term.dispose(); return; }
        }
        term.open(container);
        termRef.current = term;
        fitAddonRef.current = fitAddon;

        // ── File path link provider — makes file paths clickable ──
        if (config.cwd) {
          linkProviderDisposableRef.current = createFilePathLinkProvider(term, {
            projectPath: config.cwd,
            onLinkHoverChange: (hovering) => {
              linkHoverRef.current = hovering;
              if (linkHoverTimeoutRef.current) {
                clearTimeout(linkHoverTimeoutRef.current);
                linkHoverTimeoutRef.current = null;
              }
              if (hovering) {
                // Safety timeout: auto-reset in case leave() never fires
                linkHoverTimeoutRef.current = setTimeout(() => {
                  linkHoverRef.current = false;
                  linkHoverTimeoutRef.current = null;
                }, 500);
              }
            },
          });
        }

        // ── URL link provider — makes http/https URLs clickable ──
        try {
          urlLinkProviderDisposableRef.current = createUrlLinkProvider(term, {
            onLinkHoverChange: (hovering) => {
              linkHoverRef.current = hovering;
              if (linkHoverTimeoutRef.current) {
                clearTimeout(linkHoverTimeoutRef.current);
                linkHoverTimeoutRef.current = null;
              }
              if (hovering) {
                linkHoverTimeoutRef.current = setTimeout(() => {
                  linkHoverRef.current = false;
                  linkHoverTimeoutRef.current = null;
                }, 500);
              }
            },
          });
        } catch (err) {
          console.error("[useTerminal] Failed to register URL link provider:", err);
        }

        // ── Drag-distance tracking for OSC 52 clipboard filter ──
        // Composite condition: mouse must be held for >= 150ms AND moved >= 5px
        // to count as intentional drag. Prevents accidental copy during fast work.
        const DRAG_THRESHOLD_PX = 5;
        const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
        const DRAG_TIME_THRESHOLD_MS = 150;
        const onDragMouseDown = (e: MouseEvent) => {
          dragDistanceRef.current = { exceeded: false, startX: e.clientX, startY: e.clientY, startTime: Date.now() };
        };
        const onDragMouseMove = (e: MouseEvent) => {
          if (dragDistanceRef.current.exceeded) return;
          if (Date.now() - dragDistanceRef.current.startTime < DRAG_TIME_THRESHOLD_MS) {
            // Keep resetting origin so distance is measured only after the hold period.
            dragDistanceRef.current.startX = e.clientX;
            dragDistanceRef.current.startY = e.clientY;
            return;
          }
          const dx = e.clientX - dragDistanceRef.current.startX;
          const dy = e.clientY - dragDistanceRef.current.startY;
          if (dx * dx + dy * dy >= DRAG_THRESHOLD_SQ) {
            dragDistanceRef.current.exceeded = true;
          }
        };
        // Copy on Select: copy cached selection text on mouseup if drag was intentional.
        // Skip when tmux mouse mode is active — tmux handles selection via OSC 52.
        // - Local terminal: always uses tmux (mouse on) → skip
        // - SSH + remote tmux: remote tmux handles selection → skip
        // - SSH direct (no remote tmux): no tmux mouse → copy-on-select works
        const hasTmuxMouseMode = !config.isSshMode || !!config.remoteTmuxSessionName;
        const onCopyOnSelectMouseUp = () => {
          if (hasTmuxMouseMode) return;
          const { copyOnSelect } = useSettingsStore.getState();
          if (copyOnSelect && cachedSelection && dragDistanceRef.current.exceeded) {
            writeText(cachedSelection).catch((err) =>
              console.error("[CopyOnSelect] writeText failed:", err),
            );
          }
        };
        container.addEventListener("mousedown", onDragMouseDown, { capture: true });
        container.addEventListener("mousemove", onDragMouseMove, { capture: true });
        container.addEventListener("mouseup", onCopyOnSelectMouseUp);
        dragListenersRef.current = {
          cleanup: () => {
            container.removeEventListener("mousedown", onDragMouseDown, { capture: true });
            container.removeEventListener("mousemove", onDragMouseMove, { capture: true });
            container.removeEventListener("mouseup", onCopyOnSelectMouseUp);
          },
        };

        // Grab textarea reference immediately after open() — used throughout
        // initialisation for IME warm-up and jamo detection
        const xtermTextarea = container.querySelector(
          ".xterm-helper-textarea",
        ) as HTMLTextAreaElement | null;

        // ── DOM overlay for IME composing preview ──
        // Uses a positioned DOM element instead of ANSI escape sequences.
        // ANSI CUB (cursor-back) based preview breaks when PTY output moves
        // the terminal cursor between keystrokes (e.g. TUI app redraws).
        const xtermScreen = container.querySelector(".xterm-screen") as HTMLElement | null;
        const imeOverlay = document.createElement("div");
        imeOverlay.style.cssText = [
          "position:absolute",
          "pointer-events:none",
          "z-index:5",
          "display:none",
          `font-family:${term.options.fontFamily ?? "monospace"}`,
          `font-size:${term.options.fontSize ?? 14}px`,
          "line-height:1",
          "text-decoration:underline",
          `color:${currentTheme.ui.compositionForeground}`,
          `background:${currentTheme.xterm.background ?? "#1a1b26"}`,
          "white-space:pre",
        ].join(";");
        // Clipboard "Copied!" toast overlay.
        // Shown when OSC 52 clipboard write succeeds (mouse drag-select in tmux).
        const clipboardToast = document.createElement("div");
        clipboardToast.style.cssText = [
          "position:absolute", "pointer-events:none", "z-index:10",
          "bottom:12px", "left:50%", "transform:translateX(-50%)",
          "padding:4px 12px", "border-radius:6px",
          "font-size:12px", "font-weight:500", "opacity:0",
          "transition:opacity 150ms ease-in-out",
          "color:rgba(255,255,255,0.9)",
          "background:rgba(0,0,0,0.65)",
          "backdrop-filter:blur(8px)", "-webkit-backdrop-filter:blur(8px)",
          "border:1px solid rgba(255,255,255,0.1)",
          "white-space:nowrap",
        ].join(";");
        clipboardToast.textContent = "Copied!";

        const showClipboardToast = () => {
          // Reset timer on rapid re-selections
          if (clipboardToastTimeoutRef.current) {
            clearTimeout(clipboardToastTimeoutRef.current);
          }
          clipboardToast.style.opacity = "1";
          clipboardToastTimeoutRef.current = setTimeout(() => {
            clipboardToast.style.opacity = "0";
            clipboardToastTimeoutRef.current = null;
          }, 1500);
        };

        if (xtermScreen) {
          if (getComputedStyle(xtermScreen).position === "static") {
            xtermScreen.style.position = "relative";
          }
          xtermScreen.appendChild(imeOverlay);
          xtermScreen.appendChild(clipboardToast);
        }

        // macOS IME pre-warm: focus textarea early so macOS starts IME context
        // initialisation now. The await below (~100ms+ for fonts + rAF) gives
        // the OS enough time to complete initialisation before user interaction.
        if (xtermTextarea) {
          xtermTextarea.focus();
        }

        // Wait for fonts + layout to settle before fitting
        await Promise.all([
          document.fonts.ready,
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
        ]);
        if (isStale()) {
          term.dispose();
          return;
        }
        fitAddon.fit();

        const cols = term.cols || config.cols;
        const rows = term.rows || config.rows;

        // Spawn PTY — SSH direct mode or local tmux mode
        const { spawn } = await import("tauri-pty");
        if (isStale()) {
          term.dispose();
          return;
        }

        let pty;
        if (config.isSshMode && config.sshArgs) {
          // SSH direct mode: spawn ssh process directly, no local tmux wrapper.
          // tauri-pty provides a PTY, so SSH gets a pseudo-terminal automatically.
          // The -t flag in sshArgs is only for remote tmux allocation.
          try {
            pty = spawn("ssh", config.sshArgs, {
              name: "xterm-256color",
              cols,
              rows,
            });
          } catch (spawnErr) {
            const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
            throw new Error(
              msg.includes("ENOENT")
                ? "SSH client not found. Please ensure OpenSSH is installed."
                : `Failed to start SSH connection: ${msg}`,
            );
          }
        } else {
          // Project mode: existing local tmux spawn logic
          // -A flag: create session if not exists, attach if it does
          const args = [
            "new-session", "-A", "-s", config.sessionName,
            "-x", String(cols), "-y", String(rows),
            ";", "set-option", "mouse", "on",
            ";", "set-option", "set-clipboard", "on",
            // Enable true color (24-bit RGB) passthrough: tmux 3.2+
            ";", "set-option", "-as", "terminal-features", ",xterm-256color:RGB",
            // MouseDown1Pane: focus clicked pane + clear selection (preserve scroll position for drag).
            // NOTE: These copy-mode bindings are also configured in
            // src-tauri/src/services/tmux.rs create_session() and ssh.rs build_remote_tmux_command().
            // Keep all three in sync.
            ";", "bind-key", "-T", "copy-mode", "MouseDown1Pane",
                "select-pane", "-t", "=", "\\;", "send-keys", "-X", "clear-selection",
            ";", "bind-key", "-T", "copy-mode-vi", "MouseDown1Pane",
                "select-pane", "-t", "=", "\\;", "send-keys", "-X", "clear-selection",
            // MouseUp1Pane: exit copy mode on simple click (does not fire after drag).
            ";", "bind-key", "-T", "copy-mode", "MouseUp1Pane",
                "send-keys", "-X", "cancel",
            ";", "bind-key", "-T", "copy-mode-vi", "MouseUp1Pane",
                "send-keys", "-X", "cancel",
            // MouseDragEnd1Pane: copy text to tmux paste buffer, emit OSC 52
            // (because set-clipboard is on), then exit copy mode to clear cursor remnant.
            ";", "bind-key", "-T", "copy-mode", "MouseDragEnd1Pane",
                "send-keys", "-X", "copy-selection-and-cancel",
            ";", "bind-key", "-T", "copy-mode-vi", "MouseDragEnd1Pane",
                "send-keys", "-X", "copy-selection-and-cancel",
            // Cancel copy mode on the previously-active pane when switching panes.
            ";", "set-hook", "window-pane-changed",
                "send-keys -t '{last}' -X cancel",
          ];

          pty = spawn("tmux", args, {
            name: "xterm-256color",
            cols,
            rows,
            ...(config.cwd ? { cwd: config.cwd } : {}),
          });
        }
        ptyRef.current = pty;
        aliveRef.current = true;

        // Notify caller of PTY pid (used by SSH store to kill orphaned processes)
        const pid = (pty as unknown as { pid?: number }).pid;
        if (pid != null && onPtySpawnRef.current) {
          onPtySpawnRef.current(pid);
        }

        // PTY → Terminal
        // Our patched tauri-plugin-pty returns raw Vec<u8> from read(),
        // which arrives as number[] via Tauri IPC. We convert to Uint8Array
        // and pass directly to xterm.js's byte parser, which correctly
        // handles partial multi-byte UTF-8 sequences (Korean/CJK/emoji)
        // split across read boundaries.
        let firstDataLogged = false;

        pty.onData((data: Uint8Array | string | number[]) => {
          // Use isStale() instead of aliveRef — aliveRef is shared across
          // connections and can be corrupted by the previous PTY's onExit
          // firing after the new connection sets aliveRef = true.
          if (isStale() || !termRef.current) return;
          if (!firstDataLogged) {
            firstDataLogged = true;
          }
          if (data instanceof Uint8Array) {
            termRef.current.write(data);
          } else if (Array.isArray(data)) {
            termRef.current.write(new Uint8Array(data));
          } else {
            // Fallback for string data (shouldn't happen with patched plugin)
            termRef.current.write(data);
          }
        });

        // ── WKWebView Korean IME handling ──
        // macOS WKWebView does NOT fire compositionstart/end for Korean.
        // Instead it uses insertText + insertReplacementText.
        // Critical: event order is beforeinput → onData → input → keydown
        // (keydown fires LAST, not first like standard browsers).
        //
        // Strategy:
        //  1. Set imeActive in beforeinput (fires before onData)
        //  2. Suppress onData during IME to prevent raw jamo reaching PTY
        //  3. Track textarea content — flush finalized syllables at boundaries
        //  4. On non-229 keydown (Enter, Space, etc.), flush remaining text

        let imeActive = false;
        // True when native compositionstart/end events fire (release WKWebView).
        // When true, xterm.js's built-in .composition-view handles the preview
        // so we suppress our custom imeOverlay to avoid double display.
        let nativeCompositionActive = false;
        // How many characters from textarea start were already sent to PTY
        let imeFlushedLen = 0;
        // Width (in terminal columns) of current inline preview
        let imePreviewCols = 0;

        // Clipboard selection cache — WKWebView returns empty string from
        // getSelection() during keydown, so we cache on every selection change.
        let cachedSelection = "";

        // ── DEBUG LOGGING ──
        const IME_DEBUG = false;
        const imeLog = (...args: unknown[]) => {
          if (IME_DEBUG) console.log("[IME]", ...args);
        };

        const isKorean = (ch: string): boolean => {
          const c = ch.charCodeAt(0);
          // Hangul Compatibility Jamo OR Hangul Syllables
          return (c >= 0x3131 && c <= 0x3163) || (c >= 0xAC00 && c <= 0xD7A3);
        };

        // Hide DOM overlay preview
        const imeClearPreview = () => {
          if (imePreviewCols > 0) {
            imeLog("clearPreview");
            imeOverlay.style.display = "none";
            imeOverlay.textContent = "";
            imePreviewCols = 0;
          }
        };

        // Calculate cell dimensions from xterm screen size
        const getCellSize = (): { w: number; h: number } => {
          if (!xtermScreen || !term.cols || !term.rows) return { w: 8, h: 18 };
          return {
            w: xtermScreen.clientWidth / term.cols,
            h: xtermScreen.clientHeight / term.rows,
          };
        };

        // Show composing character as DOM overlay at terminal cursor position.
        // Reads cursor position from xterm buffer (immune to PTY output race).
        const imeShowPreview = (ch: string) => {
          if (!termRef.current || !ch) return;
          const c = ch.charCodeAt(0);
          const newCols = ((c >= 0x3131 && c <= 0x3163) || (c >= 0xAC00 && c <= 0xD7A3)) ? 2 : 1;
          imeLog("showPreview ch=", JSON.stringify(ch), "U+"+c.toString(16), "cursorX=", termRef.current.buffer.active.cursorX, "cursorY=", termRef.current.buffer.active.cursorY);

          const buf = termRef.current.buffer.active;
          const { w, h } = getCellSize();

          imeOverlay.textContent = ch;
          imeOverlay.style.left = `${buf.cursorX * w}px`;
          imeOverlay.style.top = `${buf.cursorY * h}px`;
          imeOverlay.style.width = `${newCols * w}px`;
          imeOverlay.style.height = `${h}px`;
          imeOverlay.style.display = "block";
          imePreviewCols = newCols;
        };

        // Send un-flushed finalized text from textarea to PTY
        const imeFlush = () => {
          if (!xtermTextarea || !aliveRef.current || !ptyRef.current) return;
          const val = xtermTextarea.value;
          imeLog("flush val=", JSON.stringify(val), "flushedLen=", imeFlushedLen, "toSend=", JSON.stringify(val.substring(imeFlushedLen)));
          if (val.length > imeFlushedLen) {
            imeClearPreview();
            ptyRef.current.write(val.substring(imeFlushedLen));
            imeFlushedLen = val.length;
          }
        };

        const imeReset = () => {
          imeLog("reset (was active=", imeActive, "flushedLen=", imeFlushedLen, ")");
          imeClearPreview();
          imeActive = false;
          imeFlushedLen = 0;
          if (xtermTextarea) xtermTextarea.value = "";
        };

        // Track press position for forward-drag direction detection.
        // Used to decide whether to inject a col+1 motion before release.
        let dragPressCol = 0;
        let dragPressRow = 0;

        // Terminal → PTY: user keystrokes (with IME guard)
        term.onData((data: string) => {
          imeLog("onData", JSON.stringify(data), "imeActive=", imeActive, "hex=", [...data].map(c => "U+"+c.charCodeAt(0).toString(16)).join(","));
          // Track left-button press position for drag direction detection.
          // mc < 64 excludes scroll events (wheel-up=64, wheel-down=65)
          // whose low bits also equal 0.
          {
            const mc = parseMouseButtonCode(data);
            if (mc !== null && mc < 64 && (mc & 3) === 0 && !data.endsWith("m") && (mc & 32) === 0) {
              const pos = parseSgrPos(data);
              if (pos) { dragPressCol = pos.col; dragPressRow = pos.row; }
            }
          }
          if (imeActive && parseMouseButtonCode(data) === null) return;
          // Suppress mouse click escape sequences while hovering a file path link.
          // Prevents tmux MouseUp1Pane from canceling copy-mode (scroll to bottom).
          if (linkHoverRef.current && isMouseClickEscapeSequence(data)) {
            imeLog("onData SUPPRESSED (link hover mouse event)", JSON.stringify(data));
            return;
          }
          // Suppress mouse drag motion escape sequences during micro-drags
          // (before composite threshold exceeded: 150ms hold, then 5px movement).
          // Prevents tmux from entering copy-mode on accidental tiny mouse movements.
          // Button press/release events still pass through for pane focus and click handling.
          if (
            dragDistanceRef.current.startTime > 0 &&
            !dragDistanceRef.current.exceeded &&
            isMouseDragMotionSequence(data)
          ) {
            imeLog("onData SUPPRESSED (drag motion below threshold)", JSON.stringify(data));
            return;
          }
          if (aliveRef.current && ptyRef.current) {
            // tmux copy-mode uses exclusive-end: the character at the cursor
            // position is NOT included in the copied text. For L→R drags,
            // inject a synthetic motion at col+1 so the cursor moves past
            // the last desired character before copy-selection-and-cancel fires.
            if (dragDistanceRef.current.exceeded && isSgrMouseRelease(data)) {
              const releasePos = parseSgrPos(data);
              // Forward drag: release is on a later row, or same row with col >= press.
              // Only inject col+1 motion for forward drags to fix exclusive-end.
              if (releasePos && (
                releasePos.row > dragPressRow ||
                (releasePos.row === dragPressRow && releasePos.col >= dragPressCol)
              )) {
                const motionSeq = sgrReleaseToMotionPlusOne(data);
                if (motionSeq) ptyRef.current.write(motionSeq);
              }
            }
            ptyRef.current.write(data);
          }
        });

        if (xtermTextarea) {
          xtermTextarea.setAttribute("inputmode", "text");
          xtermTextarea.setAttribute("autocapitalize", "off");
          xtermTextarea.setAttribute("autocomplete", "off");
          xtermTextarea.setAttribute("spellcheck", "false");

          // beforeinput fires BEFORE onData in WKWebView — this is where
          // we must set imeActive to suppress the subsequent onData call.
          xtermTextarea.addEventListener("beforeinput", (e: Event) => {
            const ie = e as InputEvent;
            imeLog("beforeinput type=", ie.inputType, "data=", JSON.stringify(ie.data), "imeActive=", imeActive);

            // IME updating the composing syllable (e.g. ㅎ→하→한)
            if (ie.inputType === "insertReplacementText") {
              imeActive = true;
              return;
            }

            // Standard composition events (non-WKWebView systems)
            if (
              ie.inputType === "insertCompositionText" ||
              ie.inputType === "insertFromComposition"
            ) {
              imeActive = true;
              return;
            }

            if (ie.inputType === "insertText" && ie.data) {
              if (isKorean(ie.data)) {
                if (imeActive) {
                  // Syllable boundary: insertText(jamo) after insertReplacementText
                  // means the previous syllable is finalized in the textarea.
                  // Flush it before the new jamo is appended.
                  imeLog("beforeinput: syllable boundary flush");
                  imeFlush();
                } else {
                  // Starting new IME session — skip any pre-existing textarea content
                  // that was already sent to PTY (e.g. space/punctuation inserted after
                  // the previous IME reset).
                  const existing = xtermTextarea?.value.length ?? 0;
                  imeLog("beforeinput: new IME session, skip existing chars=", existing);
                  imeFlushedLen = existing;
                }
                // Set imeActive BEFORE onData fires for this character
                imeActive = true;
                return;
              }

              // Non-Korean insertText while IME was active → IME ending
              if (imeActive) {
                imeLog("beforeinput: non-Korean ends IME");
                imeFlush();
                imeReset();
                // Let the non-Korean char proceed normally (onData will handle it)
              }
            }
          });

          // Composition events (for systems that DO fire them)
          xtermTextarea.addEventListener("compositionstart", () => {
            if (!imeActive) {
              // Starting new IME session via native composition — skip any
              // pre-existing textarea content already sent to PTY.
              // Mirrors beforeinput's insertText+Korean branch (dev mode path).
              imeFlushedLen = xtermTextarea?.value.length ?? 0;
            }
            imeActive = true;
            nativeCompositionActive = true;
          });

          xtermTextarea.addEventListener("compositionend", (_e: CompositionEvent) => {
            nativeCompositionActive = false;
            imeClearPreview();
            // Send any unflushed composed text
            if (xtermTextarea && aliveRef.current && ptyRef.current) {
              const val = xtermTextarea.value;
              if (val.length > imeFlushedLen) {
                ptyRef.current.write(val.substring(imeFlushedLen));
              }
            }
            imeActive = false;
            imeFlushedLen = 0;
            if (xtermTextarea) xtermTextarea.value = "";
          });

          // Update inline preview and clamp flush tracking
          xtermTextarea.addEventListener("input", () => {
            imeLog("input event val=", JSON.stringify(xtermTextarea?.value), "imeActive=", imeActive, "flushedLen=", imeFlushedLen);
            if (!imeActive || !xtermTextarea) return;
            const val = xtermTextarea.value;
            // Clamp flush tracking when textarea shrinks (e.g. Backspace)
            if (imeFlushedLen > val.length) {
              imeLog("input: clamp flushedLen", imeFlushedLen, "→", val.length);
              imeFlushedLen = val.length;
            }
            // Show the current composing character (last char after flushed portion).
            // Our custom imeOverlay is always used — xterm.js's built-in .composition-view
            // is hidden via CSS (see index.css).
            const composing = val.substring(imeFlushedLen);
            imeLog("input: composing=", JSON.stringify(composing), "nativeComp=", nativeCompositionActive);
            if (composing.length > 0) {
              imeShowPreview(composing.charAt(composing.length - 1));
            } else {
              imeClearPreview();
            }
          });
        }

        // Cache selection text on every change — belt-and-suspenders for
        // any remaining edge cases where getSelection() returns "" during keydown.
        term.onSelectionChange(() => {
          cachedSelection = term.getSelection();
        });

        // keydown fires AFTER beforeinput/onData in WKWebView.
        // For Korean keys (keyCode=229), imeActive is already set by beforeinput.
        // For non-Korean keys, this is where we detect IME ending.
        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          if (event.type === "keydown") {
            // ── Pane shortcuts (Meta key) ──
            if (event.metaKey && !event.altKey && !event.ctrlKey) {
              // ── Clipboard shortcuts (before tmux shortcuts) ──

              // ⌘C — Copy selected text to clipboard
              // Use cached selection first (WKWebView returns "" from
              // getSelection() during keydown), fall back to direct API.
              if (event.key.toLowerCase() === "c" && !event.shiftKey) {
                const sel = cachedSelection || term.getSelection();
                if (sel) {
                  event.preventDefault();
                  writeText(sel)
                    .then(() => term.clearSelection())
                    .catch((err) =>
                      console.error("[Clipboard] writeText failed:", err),
                    );
                }
                return false;
              }

              // ⌘V — Paste from clipboard into terminal
              if (event.key.toLowerCase() === "v" && !event.shiftKey) {
                event.preventDefault();
                // Clear stale IME state so paste data isn't suppressed by the
                // onData guard. WKWebView Korean IME fires compositionstart
                // after spacebar, leaving imeActive=true with no real composition.
                if (imeActive) {
                  imeFlush();
                  imeReset();
                }
                readText()
                  .then((text) => {
                    if (text && termRef.current) {
                      termRef.current.paste(text);
                    }
                  })
                  .catch((err) =>
                    console.error("Clipboard read failed:", err),
                  );
                return false;
              }

              // ⌘A — Select all terminal content
              if (event.key.toLowerCase() === "a" && !event.shiftKey) {
                event.preventDefault();
                term.selectAll();
                return false;
              }

              // ── Cursor navigation shortcuts ──

              // ⌘← — Home (beginning of line)
              if (event.key === "ArrowLeft" && !event.shiftKey) {
                event.preventDefault();
                if (aliveRef.current && ptyRef.current) {
                  const seq = term.modes.applicationCursorKeysMode
                    ? "\x1bOH"   // Application mode: SS3 H
                    : "\x1b[H";  // Normal mode: CSI H
                  ptyRef.current.write(seq);
                }
                return false;
              }

              // ⌘→ — End (end of line)
              if (event.key === "ArrowRight" && !event.shiftKey) {
                event.preventDefault();
                if (aliveRef.current && ptyRef.current) {
                  const seq = term.modes.applicationCursorKeysMode
                    ? "\x1bOF"   // Application mode: SS3 F
                    : "\x1b[F";  // Normal mode: CSI F
                  ptyRef.current.write(seq);
                }
                return false;
              }

              // ── Pane/window shortcuts (skip in SSH mode without remote tmux) ──
              if (config.isSshMode && !config.remoteTmuxSessionName) return true;

              const sName = config.sessionName;
              const remoteSN = config.remoteTmuxSessionName;
              const connId = config.sshConnectionId;
              const isRemote = !!(remoteSN && connId);

              // Dispatch a tmux command to remote or local, surfacing errors to UI.
              function runTmuxCmd(
                localFn: (s: string) => Promise<void>,
                remoteFn: (c: string, s: string) => Promise<void>,
                label: string,
              ): void {
                const promise = isRemote
                  ? remoteFn(connId!, remoteSN!)
                  : localFn(sName);
                promise.catch((e) => {
                  console.error(`${isRemote ? "Remote " : ""}${label} failed:`, e);
                  useTerminalStore.getState().setError(
                    config.projectId,
                    `${label} failed: ${e instanceof Error ? e.message : String(e)}`,
                  );
                });
              }

              if (sName || isRemote) {
                // ⌘T — New window (via dialog)
                if (event.key.toLowerCase() === "t" && !event.shiftKey) {
                  event.preventDefault();
                  onRequestPaneActionRef.current?.("new-window");
                  return false;
                }
                // ⌘⇧W — Close window (check before ⌘W pane close)
                if (event.key.toLowerCase() === "w" && event.shiftKey) {
                  event.preventDefault();
                  runTmuxCmd(commands.closeTmuxWindow, commands.remoteTmuxCloseWindow, "close window");
                  return false;
                }
                // ⌘⇧] — Next window (event.code for keyboard layout independence)
                if (event.code === "BracketRight" && event.shiftKey) {
                  event.preventDefault();
                  runTmuxCmd(commands.nextTmuxWindow, commands.remoteTmuxNextWindow, "next window");
                  return false;
                }
                // ⌘⇧[ — Previous window
                if (event.code === "BracketLeft" && event.shiftKey) {
                  event.preventDefault();
                  runTmuxCmd(commands.previousTmuxWindow, commands.remoteTmuxPreviousWindow, "previous window");
                  return false;
                }
                // ⌘⇧D — Split horizontal (via dialog)
                if (event.key.toLowerCase() === "d" && event.shiftKey) {
                  event.preventDefault();
                  onRequestPaneActionRef.current?.("split-horizontal");
                  return false;
                }
                // ⌘D — Split vertical (via dialog)
                if (event.key.toLowerCase() === "d" && !event.shiftKey) {
                  event.preventDefault();
                  onRequestPaneActionRef.current?.("split-vertical");
                  return false;
                }
                // ⌘W — Close pane
                if (event.key.toLowerCase() === "w" && !event.shiftKey) {
                  event.preventDefault();
                  runTmuxCmd(commands.closeTmuxPane, commands.remoteTmuxClosePane, "close pane");
                  return false;
                }
              }
            }
            // ── IME handling ──
            imeLog("keydown key=", event.key, "code=", event.keyCode, "isComposing=", event.isComposing, "imeActive=", imeActive);
            if (event.isComposing || event.keyCode === 229) {
              imeActive = true;
              return false;
            }
            // Non-IME key while composing → flush remaining text and end IME
            if (imeActive) {
              // Modifier keys must not break composition (Shift is needed for ㅆㄲㅃㄸㅉㅒㅖ)
              const k = event.key;
              if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") {
                return false;
              }
              imeLog("keydown: non-IME key ends composition");
              imeFlush();
              imeReset();
            }
          }
          return true;
        });

        // Handle PTY exit — guard against stale callbacks from old PTY.
        // CRITICAL: Use isStale() instead of aliveRef. When rapidly switching
        // projects, the old PTY's onExit fires AFTER the new connection sets
        // aliveRef = true, causing it to pass the !aliveRef guard and corrupt
        // aliveRef for the new connection (setting it to false). This makes
        // the new PTY's onData silently drop all data → blank screen.
        pty.onExit(() => {
          if (isStale()) return; // a newer connection is active — ignore this exit
          aliveRef.current = false;
          // Don't overwrite "error" status — Kill All sets it to prevent auto-reconnect
          const current = useTerminalStore.getState().getTerminal(config.projectId).status;
          if (current !== "error") {
            useTerminalStore.getState().setStatus(config.projectId, "disconnected");
          }
        });

        // ResizeObserver for auto-fit
        const observer = new ResizeObserver(() => {
          if (aliveRef.current && fitAddonRef.current && termRef.current && ptyRef.current) {
            fitAddonRef.current.fit();
            try {
              ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
            } catch {
              // PTY may have exited between check and resize
            }
            // Force repaint after resize — xterm.js DOM renderer can miss
            // repaints when container dimensions change during rapid transitions.
            termRef.current.refresh(0, termRef.current.rows - 1);
          }
        });
        observer.observe(container);
        observerRef.current = observer;

        useTerminalStore.getState().setStatus(config.projectId, "connected");

        // Force a full terminal repaint — ensures content is visible even if
        // the initial paint was missed due to layout timing during fast switch.
        term.refresh(0, term.rows - 1);

        // Explicitly resize PTY to current terminal size — forces tmux to
        // redraw the window contents. Without this, if the PTY was spawned
        // with the exact same size as fitAddon calculated, tmux may not send
        // an initial screen refresh.
        try {
          pty.resize(term.cols, term.rows);
        } catch {
          // PTY may have exited
        }

        // Subscribe to runtime theme/opacity/font changes from settings store.
        // Glass mode changes are handled by TerminalPage via React key remount.
        let prevThemeId = useSettingsStore.getState().terminalTheme;
        let prevOpacity = useSettingsStore.getState().terminalOpacity;
        let prevFontFamily = useSettingsStore.getState().terminalFontFamily;
        let prevFontSize = useSettingsStore.getState().terminalFontSize;
        themeUnsubRef.current = useSettingsStore.subscribe((state) => {
          const opacityChanged = state.terminalOpacity !== prevOpacity;
          const themeChanged = state.terminalTheme !== prevThemeId;
          const fontFamilyChanged = state.terminalFontFamily !== prevFontFamily;
          const fontSizeChanged = state.terminalFontSize !== prevFontSize;

          if (themeChanged || opacityChanged) {
            prevThemeId = state.terminalTheme;
            prevOpacity = state.terminalOpacity;
            try {
              if (termRef.current) {
                const newTheme = getThemeById(state.terminalTheme);
                const opacity = state.terminalOpacity;
                termRef.current.options.theme = applyOpacityToTheme(newTheme.xterm, opacity);
                termRef.current.refresh(0, termRef.current.rows - 1);
                // Update IME overlay colors
                imeOverlay.style.color = newTheme.ui.compositionForeground;
                const bgColor = applyOpacityToTheme(newTheme.xterm, opacity).background ?? "#1a1b26";
                imeOverlay.style.background = bgColor;
              }
            } catch (err) {
              console.error(
                "[useTerminal] Failed to apply runtime theme change:",
                err,
              );
            }
          }

          if (fontFamilyChanged || fontSizeChanged) {
            prevFontFamily = state.terminalFontFamily;
            prevFontSize = state.terminalFontSize;
            const applyFont = () => {
              try {
                if (termRef.current) {
                  const newFont = getFontById(state.terminalFontFamily);
                  termRef.current.options.fontFamily = newFont.fontFamily;
                  termRef.current.options.fontSize = state.terminalFontSize;
                  // Update IME overlay to match new font
                  imeOverlay.style.fontFamily = newFont.fontFamily;
                  imeOverlay.style.fontSize = `${state.terminalFontSize}px`;
                  // Re-fit to recalculate cell dimensions for new font metrics
                  if (fitAddonRef.current) {
                    fitAddonRef.current.fit();
                    if (ptyRef.current && termRef.current) {
                      try {
                        ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
                      } catch {
                        // PTY may have exited
                      }
                    }
                  }
                }
              } catch (err) {
                console.error(
                  "[useTerminal] Failed to apply runtime font change:",
                  err,
                );
              }
            };
            if (fontFamilyChanged) {
              const newFont = getFontById(state.terminalFontFamily);
              // 1. Load @font-face CSS  2. xterm loadFonts()  3. apply
              loadFontCss(newFont).then(async () => {
                if (newFont.category === "popular") {
                  try {
                    await xtermLoadFonts([newFont.name]);
                  } catch {
                    // Font not in document.fonts — fallback
                  }
                }
                applyFont();
              });
            } else {
              applyFont();
            }
          }
        });

        // Send initial command to the shell after it has started
        if (config.initialCommand) {
          initialCmdTimeoutRef.current = setTimeout(() => {
            initialCmdTimeoutRef.current = null;
            if (aliveRef.current && ptyRef.current) {
              ptyRef.current.write(config.initialCommand + "\n");
            }
          }, 300);
        }

        // Register session in DB for project ownership tracking
        // Skip for SSH mode — no local tmux session to register
        if (config.projectId && !config.isSshMode && !isStale()) {
          useTmuxStore
            .getState()
            .registerSession(config.projectId, config.sessionName)
            .catch(() => {
              // Registration failure is non-fatal (session still works)
            });
        }

        // Focus AFTER React has re-rendered (overlay removed)
        requestAnimationFrame(() => {
          if (!isStale() && termRef.current) {
            termRef.current.focus();
          }
          // macOS IME warm-up: blur + refocus cycle to ensure a clean IME
          // context. Apple FB17460926 — rAF gaps let the OS process each step.
          requestAnimationFrame(() => {
            if (xtermTextarea && !isStale() && aliveRef.current) {
              xtermTextarea.blur();
              requestAnimationFrame(() => {
                if (termRef.current && !isStale()) {
                  termRef.current.focus();
                }
              });
            }
          });
        });

        // ── Timers: set BEFORE any remaining awaits so they always fire ──

        // Re-fit after 200ms to catch font loading & final layout shifts.
        refitTimeoutRef.current = setTimeout(() => {
          refitTimeoutRef.current = null;
          if (aliveRef.current && fitAddonRef.current && termRef.current && ptyRef.current) {
            fitAddonRef.current.fit();
            try {
              ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
            } catch {
              // ignore
            }
            termRef.current.refresh(0, termRef.current.rows - 1);
          }
        }, 200);

        // ── Tier 1 recovery: tmux refresh-client (800ms) ──
        // Uses Rust IPC to call `tmux refresh-client` directly, bypassing
        // SIGWINCH coalescing issues entirely.
        tier1TimeoutRef.current = setTimeout(async () => {
          tier1TimeoutRef.current = null;
          if (!firstDataLogged && !isStale() && ptyRef.current && !config.isSshMode) {
            try {
              await commands.refreshTmuxClient(config.sessionName);
            } catch (e) {
              // Expected: tmux client might not be attached yet — tier 2 will handle it.
              const msg = String(e);
              if (!msg.includes("no current client") && !msg.includes("no server running")) {
                console.warn("[useTerminal] Tier 1 recovery unexpected error:", e);
              }
            }
          }
        }, 800);

        // ── Tier 2 recovery: resize cycle with 50ms gap (2000ms) ──
        // Fallback if refresh-client didn't trigger data. The 50ms gap
        // between shrink and restore prevents OS SIGWINCH coalescing.
        tier2TimeoutRef.current = setTimeout(() => {
          tier2TimeoutRef.current = null;
          if (!firstDataLogged && !isStale() && ptyRef.current && termRef.current) {
            try {
              ptyRef.current.resize(term.cols - 1, term.rows);
              setTimeout(() => {
                if (!isStale() && ptyRef.current && termRef.current) {
                  try {
                    ptyRef.current.resize(term.cols, term.rows);
                  } catch { /* PTY exited */ }
                }
              }, 50);
            } catch { /* PTY exited */ }
          }
        }, 2000);

        // ── Tauri drag-drop → PTY path injection (fire-and-forget) ──
        // Wrapped in async IIFE so awaits don't block the main connect flow.
        // The timers above are already set, so even if this fails, recovery works.
        (async () => {
          try {
            const { getCurrentWebview } = await import("@tauri-apps/api/webview");
            if (isStale()) return;

            const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
              if (!isActiveRef.current) return;
              if (event.payload.type === "enter") {
                onDragStateRef.current?.(true);
              } else if (event.payload.type === "leave") {
                onDragStateRef.current?.(false);
              } else if (event.payload.type === "drop") {
                onDragStateRef.current?.(false);
                if (aliveRef.current && ptyRef.current) {
                  const paths = event.payload.paths;
                  if (paths.length > 0) {
                    const escaped = paths.map((p) => escapeShellPath(p)).join(" ");
                    ptyRef.current.write(escaped);
                  }
                }
              }
            });

            if (isStale()) {
              unlisten();
              return;
            }
            unlistenRef.current = unlisten;
          } catch (e) {
            console.error("[useTerminal] drag-drop setup failed:", e);
          }
        })();
      } catch (err) {
        if (!isStale()) {
          const message = err instanceof Error ? err.message : String(err);
          useTerminalStore.getState().setError(config.projectId, message);
          cleanup();
        }
      }

    },
    [cleanup],
  );

  const disconnect = useCallback(() => {
    cleanup();
    const pid = projectIdRef.current;
    if (pid) {
      // Guard: don't overwrite "idle" status during intentional reconnection.
      // When handleRetry() sets status to "idle" and TerminalView unmounts,
      // this cleanup runs — without the guard it would set "disconnected"
      // and trigger an infinite reconnect loop.
      const currentStatus = useTerminalStore.getState().getTerminal(pid).status;
      if (currentStatus !== "idle") {
        useTerminalStore.getState().setStatus(pid, "disconnected");
      }
    }
  }, [cleanup]);

  const refit = useCallback(() => {
    if (fitAddonRef.current && termRef.current && ptyRef.current && aliveRef.current) {
      fitAddonRef.current.fit();
      safePtyResize(ptyRef.current, termRef.current.cols, termRef.current.rows);
      termRef.current.refresh(0, termRef.current.rows - 1);
      termRef.current.focus();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Sleep/wake recovery:
  // 1. Refreshes terminal UI after wake (cosmetic)
  // 2. SSH mode: sends resize probe to accelerate dead-connection detection
  //    (faster than waiting for ServerAliveInterval keepalive timeout).
  useEffect(() => {
    const handleWake = () => {
      const term = termRef.current;
      const pty = ptyRef.current;
      if (!term || !pty) {
        console.warn("[useTerminal] Wake detected but terminal/PTY refs are null — skipping");
        return;
      }

      // Always refresh display
      try {
        term.refresh(0, term.rows - 1);
      } catch (e) {
        console.error("[useTerminal] Terminal refresh after wake failed:", e);
      }

      // SSH mode: resize probe to force immediate server communication.
      // The resize sends SIGWINCH -> SSH window-change request -> TCP write.
      // If TCP is dead (post-sleep), this accelerates keepalive failure detection.
      if (!configRef.current?.isSshMode || !aliveRef.current) {
        console.info("[useTerminal] Wake detected — refreshed terminal display");
        return;
      }

      console.info("[useTerminal] Wake detected in SSH mode — sending resize probe");
      safePtyResize(pty, Math.max(1, term.cols - 1), term.rows);

      // Restore original size after 100ms
      if (wakeResizeTimeoutRef.current) {
        clearTimeout(wakeResizeTimeoutRef.current);
      }
      wakeResizeTimeoutRef.current = setTimeout(() => {
        wakeResizeTimeoutRef.current = null;
        if (aliveRef.current && ptyRef.current && termRef.current) {
          safePtyResize(ptyRef.current, termRef.current.cols, termRef.current.rows);
        }
      }, 100);
    };

    window.addEventListener("app:wake", handleWake);
    return () => window.removeEventListener("app:wake", handleWake);
  }, []);

  return { containerRef, connect, disconnect, refit };
}
