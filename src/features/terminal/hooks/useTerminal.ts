import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { useTmuxStore } from "../../tmux/stores/tmuxStore";
import * as commands from "../../../lib/tauri/commands";
import type { TerminalConfig, PaneAction } from "../types";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "tauri-pty";
import { getThemeById, applyOpacityToTheme } from "../themes";
// Direct import to avoid circular chunk dependency (terminal ↔ settings)
import { useSettingsStore } from "../../settings/stores/settingsStore";

// macOS Terminal.app / iTerm2 동작 재현: 쉘 특수문자 이스케이프
function escapeShellPath(path: string): string {
  if (/[ '"\\$`!#&|;(){}]/.test(path)) {
    return "'" + path.replace(/'/g, "'\\''") + "'";
  }
  return path;
}

interface UseTerminalOptions {
  onDragState?: (isDragging: boolean) => void;
  onRequestPaneAction?: (action: PaneAction) => void;
}

interface UseTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  connect: (config: TerminalConfig) => Promise<void>;
  disconnect: () => void;
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
  // Guard flag — prevents writes/kills after PTY has exited
  const aliveRef = useRef(false);
  // Monotonic counter — each connect() call gets a unique ID.
  // Stale async continuations check this to bail out.
  const connectIdRef = useRef(0);
  // setTimeout refs for cleanup
  const initialCmdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatus = useTerminalStore((s) => s.setStatus);
  const setError = useTerminalStore((s) => s.setError);
  const setSession = useTerminalStore((s) => s.setSession);

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

    // Unsubscribe from theme changes
    if (themeUnsubRef.current) {
      themeUnsubRef.current();
      themeUnsubRef.current = null;
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
    // Kill PTY LAST — it may already be dead, that's fine
    if (ptyRef.current) {
      const pty = ptyRef.current;
      ptyRef.current = null;
      try {
        pty.kill();
      } catch {
        // PTY already exited — "No such process (os error 3)" is expected
      }
    }
  }, []);

  const connect = useCallback(
    async (config: TerminalConfig) => {
      // Clean up any existing connection
      cleanup();
      // Capture this connection's ID — if it changes, we're stale
      const myId = connectIdRef.current;
      const isStale = () => connectIdRef.current !== myId;

      setStatus("connecting");
      setSession(config.sessionName);

      try {
        // Dynamic imports to keep xterm.js in separate chunk
        const [{ Terminal }, { FitAddon }, { Unicode11Addon }] =
          await Promise.all([
            import("@xterm/xterm"),
            import("@xterm/addon-fit"),
            import("@xterm/addon-unicode11"),
          ]);
        if (isStale()) return;

        const container = containerRef.current;
        if (!container) {
          setError("Terminal container not found");
          return;
        }

        // Create terminal instance
        const currentTheme = getThemeById(
          useSettingsStore.getState().terminalTheme,
        );
        const { terminalOpacity } = useSettingsStore.getState();

        const term = new Terminal({
          fontSize: 14,
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          theme: applyOpacityToTheme(currentTheme.xterm, terminalOpacity),
          cursorBlink: true,
          convertEol: false,
          allowProposedApi: true,
          allowTransparency: true,
          scrollback: 0,
        });

        // Load addons
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        // Unicode11 — correct double-width for Korean/CJK/emoji
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";

        term.open(container);
        termRef.current = term;
        fitAddonRef.current = fitAddon;

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
        if (xtermScreen) {
          if (getComputedStyle(xtermScreen).position === "static") {
            xtermScreen.style.position = "relative";
          }
          xtermScreen.appendChild(imeOverlay);
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

        // Spawn PTY with tmux
        const { spawn } = await import("tauri-pty");
        if (isStale()) {
          term.dispose();
          return;
        }

        // -A flag: create session if not exists, attach if it does
        const args = ["new-session", "-A", "-s", config.sessionName, "-x", String(cols), "-y", String(rows)];

        const pty = spawn("tmux", args, {
          name: "xterm-256color",
          cols,
          rows,
          ...(config.cwd ? { cwd: config.cwd } : {}),
        });
        ptyRef.current = pty;
        aliveRef.current = true;

        // PTY → Terminal
        // Our patched tauri-plugin-pty returns raw Vec<u8> from read(),
        // which arrives as number[] via Tauri IPC. We convert to Uint8Array
        // and pass directly to xterm.js's byte parser, which correctly
        // handles partial multi-byte UTF-8 sequences (Korean/CJK/emoji)
        // split across read boundaries.
        pty.onData((data: Uint8Array | string | number[]) => {
          if (!aliveRef.current || !termRef.current) return;
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
        // How many characters from textarea start were already sent to PTY
        let imeFlushedLen = 0;
        // Width (in terminal columns) of current inline preview
        let imePreviewCols = 0;

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

        // Terminal → PTY: user keystrokes (with IME guard)
        term.onData((data: string) => {
          imeLog("onData", JSON.stringify(data), "imeActive=", imeActive, "hex=", [...data].map(c => "U+"+c.charCodeAt(0).toString(16)).join(","));
          if (imeActive) return;
          if (aliveRef.current && ptyRef.current) {
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
            imeActive = true;
          });

          xtermTextarea.addEventListener("compositionend", (_e: CompositionEvent) => {
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
            // Show the current composing character (last char after flushed portion)
            const composing = val.substring(imeFlushedLen);
            imeLog("input: composing=", JSON.stringify(composing));
            if (composing.length > 0) {
              imeShowPreview(composing.charAt(composing.length - 1));
            } else {
              imeClearPreview();
            }
          });
        }

        // keydown fires AFTER beforeinput/onData in WKWebView.
        // For Korean keys (keyCode=229), imeActive is already set by beforeinput.
        // For non-Korean keys, this is where we detect IME ending.
        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          if (event.type === "keydown") {
            // ── Pane shortcuts (Meta key) ──
            if (event.metaKey && !event.altKey && !event.ctrlKey) {
              const sName = useTerminalStore.getState().sessionName;
              if (sName) {
                // ⌘T — New window (via dialog)
                if (event.key.toLowerCase() === "t" && !event.shiftKey) {
                  event.preventDefault();
                  onRequestPaneActionRef.current?.("new-window");
                  return false;
                }
                // ⌘⇧W — Close window (check before ⌘W pane close)
                if (event.key.toLowerCase() === "w" && event.shiftKey) {
                  event.preventDefault();
                  commands.closeTmuxWindow(sName).catch((e) =>
                    console.error("Close window failed:", e),
                  );
                  return false;
                }
                // ⌘⇧] — Next window (event.code for keyboard layout independence)
                if (event.code === "BracketRight" && event.shiftKey) {
                  event.preventDefault();
                  commands.nextTmuxWindow(sName).catch((e) =>
                    console.error("Next window failed:", e),
                  );
                  return false;
                }
                // ⌘⇧[ — Previous window
                if (event.code === "BracketLeft" && event.shiftKey) {
                  event.preventDefault();
                  commands.previousTmuxWindow(sName).catch((e) =>
                    console.error("Previous window failed:", e),
                  );
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
                if (event.key.toLowerCase() === "w" && !event.shiftKey) {
                  event.preventDefault();
                  commands.closeTmuxPane(sName).catch((e) =>
                    console.error("Close pane failed:", e),
                  );
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

        // Handle PTY exit
        pty.onExit(() => {
          aliveRef.current = false;
          useTerminalStore.getState().setStatus("disconnected");
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
          }
        });
        observer.observe(container);
        observerRef.current = observer;

        setStatus("connected");

        // Subscribe to runtime theme/opacity changes from settings store.
        // Glass mode changes are handled by TerminalPage via React key remount.
        let prevThemeId = useSettingsStore.getState().terminalTheme;
        let prevOpacity = useSettingsStore.getState().terminalOpacity;
        themeUnsubRef.current = useSettingsStore.subscribe((state) => {
          const opacityChanged = state.terminalOpacity !== prevOpacity;
          const themeChanged = state.terminalTheme !== prevThemeId;

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
        });

        // ── Tauri drag-drop → PTY path injection (like native terminal) ──
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (isStale()) return;

        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
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
        if (config.projectId) {
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

        // Re-fit after 200ms to catch font loading & final layout shifts
        refitTimeoutRef.current = setTimeout(() => {
          refitTimeoutRef.current = null;
          if (aliveRef.current && fitAddonRef.current && termRef.current && ptyRef.current) {
            fitAddonRef.current.fit();
            try {
              ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
            } catch {
              // ignore
            }
          }
        }, 200);
      } catch (err) {
        if (!isStale()) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          cleanup();
        }
      }

    },
    [cleanup, setStatus, setError, setSession],
  );

  const disconnect = useCallback(() => {
    cleanup();
    setStatus("disconnected");
  }, [cleanup, setStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { containerRef, connect, disconnect };
}
