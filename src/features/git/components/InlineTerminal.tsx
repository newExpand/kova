import { useEffect, useRef, useCallback, useState } from "react";
import { X, AlertCircle } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "tauri-pty";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSettingsStore } from "../../settings";
import {
  getThemeById,
  applyOpacityToTheme,
  getFontById,
  loadFontCss,
} from "../../terminal";

interface InlineTerminalProps {
  sessionName: string;
  onClose: () => void;
  height?: number;
}

const DRAG_THRESHOLD_PX = 5;
const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
const DRAG_TIME_THRESHOLD_MS = 150;

function isKorean(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x3131 && c <= 0x3163) || (c >= 0xAC00 && c <= 0xD7A3);
}

/**
 * Inline xterm.js terminal that attaches to an existing tmux session.
 * Includes: Unicode11, theme/font sync, IME Korean overlay, OSC 52 clipboard,
 * drag-distance filtering, and clipboard toast.
 */
export function InlineTerminal({ sessionName, onClose, height = 250 }: InlineTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const aliveRef = useRef(false);
  const themeUnsubRef = useRef<(() => void) | null>(null);
  const clipboardToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragDistanceRef = useRef({ exceeded: false, startX: 0, startY: 0, startTime: 0 });
  const dragListenersRef = useRef<{ cleanup: () => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    aliveRef.current = false;
    if (clipboardToastTimeoutRef.current) {
      clearTimeout(clipboardToastTimeoutRef.current);
      clipboardToastTimeoutRef.current = null;
    }
    if (themeUnsubRef.current) {
      themeUnsubRef.current();
      themeUnsubRef.current = null;
    }
    if (dragListenersRef.current) {
      dragListenersRef.current.cleanup();
      dragListenersRef.current = null;
    }
    if (ptyRef.current) {
      try { ptyRef.current.kill(); } catch (e: unknown) { console.warn("[InlineTerminal] PTY kill failed:", e); }
      ptyRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitAddonRef.current = null;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    async function init() {
      const container = containerRef.current;
      if (!container || cancelled) return;

      // Dynamic imports (code-split)
      const [
        { Terminal },
        { FitAddon },
        { Unicode11Addon },
        { WebFontsAddon },
        { spawn },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-unicode11"),
        import("@xterm/addon-web-fonts"),
        import("tauri-pty"),
      ]);
      if (cancelled) return;

      // Read current settings
      const settings = useSettingsStore.getState();
      const themePreset = getThemeById(settings.terminalTheme);
      const fontPreset = getFontById(settings.terminalFontFamily);

      const fontLoaded = await loadFontCss(fontPreset);
      if (cancelled) return;
      if (!fontLoaded) {
        console.warn(`[InlineTerminal] CSS for font "${fontPreset.name}" not loaded, using system fallback`);
      }

      const fitAddon = new FitAddon();
      const unicode11Addon = new Unicode11Addon();
      const webFontsAddon = new WebFontsAddon();

      const term = new Terminal({
        cols: 80,
        rows: 8,
        fontSize: settings.terminalFontSize,
        fontFamily: fontPreset.fontFamily,
        theme: applyOpacityToTheme(themePreset.xterm, settings.terminalOpacity),
        allowTransparency: true,
        allowProposedApi: true,
        scrollback: 500,
        cursorBlink: true,
        minimumContrastRatio: 3,
      });

      // Load addons
      term.loadAddon(fitAddon);
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = "11";
      term.loadAddon(webFontsAddon);

      // OSC 52 clipboard handler (defined before open, used after drag setup)
      let showClipboardToast: () => void = () => {};

      term.parser.registerOscHandler(52, (data: string) => {
        const idx = data.indexOf(";");
        if (idx < 0) return false;
        const payload = data.slice(idx + 1);
        if (payload === "?") return true;
        try {
          if (!dragDistanceRef.current.exceeded) return true;
          const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
          const text = new TextDecoder().decode(bytes);
          if (!text.trim()) return true;
          writeText(text)
            .then(() => showClipboardToast())
            .catch((err: unknown) =>
              console.error("[InlineTerminal OSC 52] clipboard write failed:", err),
            );
        } catch (err: unknown) {
          console.warn("[InlineTerminal OSC 52] decode/clipboard error:", err);
        }
        return true;
      });

      // Load font glyphs before open
      if (fontPreset.category === "popular") {
        try {
          await webFontsAddon.loadFonts([fontPreset.name]);
        } catch (err: unknown) {
          console.warn(`[InlineTerminal] Font "${fontPreset.name}" glyph loading failed, using system fallback:`, err);
          term.options.fontFamily = "monospace";
        }
      }
      if (cancelled) return;

      term.open(container);
      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // ── Drag-distance tracking ──
      const onDragMouseDown = (e: MouseEvent) => {
        dragDistanceRef.current = { exceeded: false, startX: e.clientX, startY: e.clientY, startTime: Date.now() };
      };
      const onDragMouseMove = (e: MouseEvent) => {
        if (dragDistanceRef.current.exceeded) return;
        if (Date.now() - dragDistanceRef.current.startTime < DRAG_TIME_THRESHOLD_MS) {
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
      container.addEventListener("mousedown", onDragMouseDown, { capture: true });
      container.addEventListener("mousemove", onDragMouseMove, { capture: true });
      dragListenersRef.current = {
        cleanup: () => {
          container.removeEventListener("mousedown", onDragMouseDown, { capture: true });
          container.removeEventListener("mousemove", onDragMouseMove, { capture: true });
        },
      };

      // Grab textarea for IME
      const xtermTextarea = container.querySelector(
        ".xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;

      // ── DOM overlays ──
      const xtermScreen = container.querySelector(".xterm-screen") as HTMLElement | null;

      // IME composing preview overlay
      const imeOverlay = document.createElement("div");
      imeOverlay.style.cssText = [
        "position:absolute", "pointer-events:none", "z-index:5", "display:none",
        `font-family:${term.options.fontFamily ?? "monospace"}`,
        `font-size:${term.options.fontSize ?? 14}px`,
        "line-height:1", "text-decoration:underline",
        `color:${themePreset.ui.compositionForeground}`,
        `background:${themePreset.xterm.background ?? "#1a1b26"}`,
        "white-space:pre",
      ].join(";");

      // Clipboard toast overlay
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

      showClipboardToast = () => {
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

      // macOS IME pre-warm
      if (xtermTextarea) {
        xtermTextarea.focus();
      }

      // Wait for fonts + layout
      await Promise.all([
        document.fonts.ready,
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ]);
      if (cancelled) return;
      fitAddon.fit();

      const cols = term.cols || 80;
      const rows = term.rows || 8;

      // Spawn PTY attached to existing tmux session
      let pty: IPty;
      try {
        pty = spawn("tmux", [
          "new-session", "-A", "-s", sessionName,
          "-x", String(cols), "-y", String(rows),
        ], {
          name: "xterm-256color",
          cols,
          rows,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[InlineTerminal] PTY spawn failed:", err);
        setErrorMsg(msg.includes("ENOENT")
          ? "tmux not found. Install via: brew install tmux"
          : `Failed to open terminal: ${msg}`);
        setStatus("error");
        return;
      }

      ptyRef.current = pty;
      aliveRef.current = true;

      // ── IME state ──
      let imeActive = false;
      let imeFlushedLen = 0;
      let imePreviewCols = 0;

      // Selection cache for clipboard (WKWebView returns "" from getSelection during keydown)
      let cachedSelection = "";

      const imeClearPreview = () => {
        if (imePreviewCols > 0) {
          imeOverlay.style.display = "none";
          imeOverlay.textContent = "";
          imePreviewCols = 0;
        }
      };

      const getCellSize = (): { w: number; h: number } => {
        if (!xtermScreen || !term.cols || !term.rows) return { w: 8, h: 18 };
        return {
          w: xtermScreen.clientWidth / term.cols,
          h: xtermScreen.clientHeight / term.rows,
        };
      };

      const imeShowPreview = (ch: string) => {
        if (!termRef.current || !ch) return;
        const c = ch.charCodeAt(0);
        const newCols = ((c >= 0x3131 && c <= 0x3163) || (c >= 0xAC00 && c <= 0xD7A3)) ? 2 : 1;
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

      const imeFlush = () => {
        if (!xtermTextarea || !aliveRef.current || !ptyRef.current) return;
        const val = xtermTextarea.value;
        if (val.length > imeFlushedLen) {
          imeClearPreview();
          ptyRef.current.write(val.substring(imeFlushedLen));
          imeFlushedLen = val.length;
        }
      };

      const imeReset = () => {
        imeClearPreview();
        imeActive = false;
        imeFlushedLen = 0;
        if (xtermTextarea) xtermTextarea.value = "";
      };

      // PTY → Terminal
      pty.onData((data: Uint8Array | string | number[]) => {
        if (!aliveRef.current || !termRef.current) return;
        if (data instanceof Uint8Array) {
          termRef.current.write(data);
        } else if (Array.isArray(data)) {
          termRef.current.write(new Uint8Array(data));
        } else {
          termRef.current.write(data);
        }
      });

      pty.onExit(({ exitCode }: { exitCode: number }) => {
        aliveRef.current = false;
        if (termRef.current) {
          termRef.current.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`);
        }
      });

      // Terminal → PTY (with IME guard)
      term.onData((data: string) => {
        if (imeActive) return;
        if (aliveRef.current && ptyRef.current) {
          ptyRef.current.write(data);
        }
      });

      // ── WKWebView Korean IME handling ──
      if (xtermTextarea) {
        xtermTextarea.setAttribute("inputmode", "text");
        xtermTextarea.setAttribute("autocapitalize", "off");
        xtermTextarea.setAttribute("autocomplete", "off");
        xtermTextarea.setAttribute("spellcheck", "false");

        xtermTextarea.addEventListener("beforeinput", (e: Event) => {
          const ie = e as InputEvent;
          if (ie.inputType === "insertReplacementText") {
            imeActive = true;
            return;
          }
          if (ie.inputType === "insertCompositionText" || ie.inputType === "insertFromComposition") {
            imeActive = true;
            return;
          }
          if (ie.inputType === "insertText" && ie.data) {
            if (isKorean(ie.data)) {
              if (imeActive) {
                imeFlush();
              } else {
                imeFlushedLen = xtermTextarea?.value.length ?? 0;
              }
              imeActive = true;
              return;
            }
            if (imeActive) {
              imeFlush();
              imeReset();
            }
          }
        });

        xtermTextarea.addEventListener("compositionstart", () => {
          if (!imeActive) {
            // Starting new IME session via native composition — skip any
            // pre-existing textarea content already sent to PTY.
            imeFlushedLen = xtermTextarea?.value.length ?? 0;
          }
          imeActive = true;
        });

        xtermTextarea.addEventListener("compositionend", () => {
          imeClearPreview();
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

        xtermTextarea.addEventListener("input", () => {
          if (!imeActive || !xtermTextarea) return;
          const val = xtermTextarea.value;
          if (imeFlushedLen > val.length) {
            imeFlushedLen = val.length;
          }
          const composing = val.substring(imeFlushedLen);
          if (composing.length > 0) {
            imeShowPreview(composing.charAt(composing.length - 1));
          } else {
            imeClearPreview();
          }
        });
      }

      // Cache selection for clipboard
      term.onSelectionChange(() => {
        cachedSelection = term.getSelection();
      });

      // Custom key event handler: clipboard shortcuts + IME ending
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type === "keydown") {
          // ⌘C / ⌘V / ⌘A
          if (event.metaKey && !event.altKey && !event.ctrlKey) {
            if (event.key.toLowerCase() === "c" && !event.shiftKey) {
              const sel = cachedSelection || term.getSelection();
              if (sel) {
                event.preventDefault();
                writeText(sel)
                  .then(() => term.clearSelection())
                  .catch((err: unknown) =>
                    console.error("[InlineTerminal] clipboard write failed:", err),
                  );
              }
              return false;
            }
            if (event.key.toLowerCase() === "v" && !event.shiftKey) {
              event.preventDefault();
              readText()
                .then((text) => {
                  if (text && termRef.current) {
                    termRef.current.paste(text);
                  }
                })
                .catch((err: unknown) =>
                  console.error("[InlineTerminal] clipboard read failed:", err),
                );
              return false;
            }
            if (event.key.toLowerCase() === "a" && !event.shiftKey) {
              event.preventDefault();
              term.selectAll();
              return false;
            }
            // ⌘← Home / ⌘→ End
            if (event.key === "ArrowLeft" && !event.shiftKey) {
              event.preventDefault();
              if (aliveRef.current && ptyRef.current) {
                ptyRef.current.write(term.modes.applicationCursorKeysMode ? "\x1bOH" : "\x1b[H");
              }
              return false;
            }
            if (event.key === "ArrowRight" && !event.shiftKey) {
              event.preventDefault();
              if (aliveRef.current && ptyRef.current) {
                ptyRef.current.write(term.modes.applicationCursorKeysMode ? "\x1bOF" : "\x1b[F");
              }
              return false;
            }
          }
          // IME handling
          if (event.isComposing || event.keyCode === 229) {
            imeActive = true;
            return false;
          }
          if (imeActive) {
            const k = event.key;
            if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") {
              return false;
            }
            imeFlush();
            imeReset();
          }
        }
        return true;
      });

      // Resize handling
      const observer = new ResizeObserver(() => {
        if (!aliveRef.current || !fitAddonRef.current || !termRef.current || !ptyRef.current) return;
        fitAddonRef.current.fit();
        try {
          ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
        } catch (e: unknown) { console.warn("[InlineTerminal] PTY resize failed:", e); }
        termRef.current.refresh(0, termRef.current.rows - 1);
      });
      observer.observe(container);

      // Force initial repaint + PTY resize
      term.refresh(0, term.rows - 1);
      try {
        pty.resize(term.cols, term.rows);
      } catch (e: unknown) { console.warn("[InlineTerminal] PTY resize failed:", e); }

      // ── Settings subscription for live theme/font updates ──
      let prevThemeId = settings.terminalTheme;
      let prevOpacity = settings.terminalOpacity;
      let prevFontId = settings.terminalFontFamily;
      let prevFontSize = settings.terminalFontSize;
      themeUnsubRef.current = useSettingsStore.subscribe((state) => {
        if (!termRef.current) return;
        const themeChanged = state.terminalTheme !== prevThemeId;
        const opacityChanged = state.terminalOpacity !== prevOpacity;
        const fontChanged = state.terminalFontFamily !== prevFontId;
        const sizeChanged = state.terminalFontSize !== prevFontSize;

        if (themeChanged || opacityChanged) {
          prevThemeId = state.terminalTheme;
          prevOpacity = state.terminalOpacity;
          const t = getThemeById(state.terminalTheme);
          termRef.current!.options.theme = applyOpacityToTheme(t.xterm, state.terminalOpacity);
          termRef.current!.refresh(0, termRef.current!.rows - 1);
          imeOverlay.style.color = t.ui.compositionForeground;
          const bgColor = applyOpacityToTheme(t.xterm, state.terminalOpacity).background ?? "#1a1b26";
          imeOverlay.style.background = bgColor;
        }

        if (fontChanged || sizeChanged) {
          prevFontId = state.terminalFontFamily;
          prevFontSize = state.terminalFontSize;
          const newFont = getFontById(state.terminalFontFamily);
          const apply = () => {
            if (!termRef.current) return;
            termRef.current.options.fontFamily = newFont.fontFamily;
            termRef.current.options.fontSize = state.terminalFontSize;
            imeOverlay.style.fontFamily = newFont.fontFamily;
            imeOverlay.style.fontSize = `${state.terminalFontSize}px`;
            fitAddonRef.current?.fit();
            if (ptyRef.current && termRef.current) {
              try { ptyRef.current.resize(termRef.current.cols, termRef.current.rows); }
              catch (e: unknown) { console.warn("[InlineTerminal] PTY resize failed:", e); }
            }
          };
          if (fontChanged) {
            loadFontCss(newFont)
              .then(() => apply())
              .catch((err: unknown) => console.warn("[InlineTerminal] font update failed:", err));
          } else {
            apply();
          }
        }
      });

      return () => observer.disconnect();
    }

    const observerCleanup = init()
      .then((disconnectFn) => {
        if (!cancelled) setStatus("ready");
        return disconnectFn;
      })
      .catch((err: unknown) => {
        console.error("[InlineTerminal] initialization failed:", err);
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMsg(msg);
          setStatus("error");
        }
        return undefined;
      });

    return () => {
      cancelled = true;
      observerCleanup.then((fn) => fn?.());
      cleanup();
    };
  }, [sessionName, cleanup]);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-white/[0.03] border-b border-white/[0.04]">
        <span className="text-[10px] text-text-muted font-mono">
          Terminal — {sessionName}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-text-muted hover:bg-white/[0.08] hover:text-text-secondary transition-colors"
          aria-label="Close terminal"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* xterm.js container */}
      <div
        ref={containerRef}
        style={{ height, width: "100%", display: status === "error" ? "none" : undefined }}
      />
      {status === "loading" && (
        <div className="flex items-center justify-center" style={{ height }}>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
          <span className="ml-2 text-xs text-text-muted">Connecting...</span>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center justify-center gap-2 px-3" style={{ height }}>
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-xs text-red-400">{errorMsg ?? "Terminal failed to initialize"}</span>
        </div>
      )}
    </div>
  );
}
