import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { useTmuxStore } from "../../tmux/stores/tmuxStore";
import type { TerminalConfig } from "../types";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "tauri-pty";

interface UseTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  connect: (config: TerminalConfig) => Promise<void>;
  disconnect: () => void;
}

export function useTerminal(): UseTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  // Guard flag — prevents writes/kills after PTY has exited
  const aliveRef = useRef(false);
  // Monotonic counter — each connect() call gets a unique ID.
  // Stale async continuations check this to bail out.
  const connectIdRef = useRef(0);

  const setStatus = useTerminalStore((s) => s.setStatus);
  const setError = useTerminalStore((s) => s.setError);
  const setSession = useTerminalStore((s) => s.setSession);

  const cleanup = useCallback(() => {
    // Mark dead FIRST so callbacks stop writing
    aliveRef.current = false;
    // Bump connect ID so any in-flight connect() bails out
    connectIdRef.current += 1;

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
        const term = new Terminal({
          fontSize: 14,
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          theme: {
            background: "#1a1b26",
            foreground: "#a9b1d6",
            cursor: "#c0caf5",
            selectionBackground: "#33467c",
          },
          cursorBlink: true,
          convertEol: false,
          allowProposedApi: true,
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
        const args =
          config.mode === "new"
            ? ["new-session", "-A", "-s", config.sessionName, "-x", String(cols), "-y", String(rows)]
            : ["attach-session", "-t", config.sessionName];

        const pty = spawn("tmux", args, {
          name: "xterm-256color",
          cols,
          rows,
        });
        ptyRef.current = pty;
        aliveRef.current = true;

        // PTY → Terminal
        // tauri-pty sends UTF-8 decoded JavaScript strings.
        // TextEncoder converts them back to UTF-8 bytes so xterm.js's
        // byte parser correctly handles escape sequences, Korean/CJK,
        // and box-drawing characters.
        const utf8Encoder = new TextEncoder();
        pty.onData((data: Uint8Array | string) => {
          if (!aliveRef.current || !termRef.current) return;
          if (typeof data === "string") {
            termRef.current.write(utf8Encoder.encode(data));
          } else {
            termRef.current.write(
              data instanceof Uint8Array ? data : new Uint8Array(data),
            );
          }
        });

        // Terminal → PTY: user keystrokes
        term.onData((data: string) => {
          if (aliveRef.current && ptyRef.current) {
            ptyRef.current.write(data);
          }
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

        // Register session in DB for project ownership tracking
        if (config.projectId && config.mode === "new") {
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
        });

        // Re-fit after 200ms to catch font loading & final layout shifts
        setTimeout(() => {
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
