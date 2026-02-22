import { useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "tauri-pty";

interface InlineTerminalProps {
  sessionName: string;
  onClose: () => void;
}

/**
 * Lightweight inline xterm.js terminal that attaches to an existing tmux session.
 * Unlike the full TerminalView/useTerminal, this component:
 * - Does NOT create new tmux sessions (uses `tmux new-session -A` which attaches if exists)
 * - Does NOT register sessions in DB
 * - Does NOT handle IME, drag-drop, or theme persistence
 * - Minimal footprint for embedding in the CommitBox area
 */
export function InlineTerminal({ sessionName, onClose }: InlineTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const aliveRef = useRef(false);

  const cleanup = useCallback(() => {
    aliveRef.current = false;
    if (ptyRef.current) {
      try { ptyRef.current.kill(); } catch { /* ignore */ }
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

      // Dynamic imports (code-split with main terminal chunk)
      const [{ Terminal }, { FitAddon }, { spawn }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("tauri-pty"),
      ]);
      if (cancelled) return;

      const fitAddon = new FitAddon();
      const term = new Terminal({
        cols: 80,
        rows: 8,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        theme: {
          background: "rgba(0, 0, 0, 0)",
          foreground: "#c0caf5",
          cursor: "#c0caf5",
          cursorAccent: "#1a1b26",
          selectionBackground: "rgba(130, 170, 255, 0.3)",
        },
        allowTransparency: true,
        scrollback: 500,
        cursorBlink: true,
      });

      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Spawn PTY attached to existing tmux session
      const cols = term.cols || 80;
      const rows = term.rows || 8;

      const pty = spawn("tmux", [
        "new-session", "-A", "-s", sessionName,
        "-x", String(cols), "-y", String(rows),
      ], {
        name: "xterm-256color",
        cols,
        rows,
      });

      ptyRef.current = pty;
      aliveRef.current = true;

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

      pty.onExit(() => {
        aliveRef.current = false;
      });

      // Terminal → PTY
      term.onData((data: string) => {
        if (aliveRef.current && ptyRef.current) {
          ptyRef.current.write(data);
        }
      });

      // Resize handling
      const observer = new ResizeObserver(() => {
        if (!aliveRef.current || !fitAddonRef.current || !ptyRef.current || !termRef.current) return;
        fitAddonRef.current.fit();
        ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
      });
      observer.observe(container);

      // Store observer for cleanup
      return () => observer.disconnect();
    }

    const observerCleanup = init();

    return () => {
      cancelled = true;
      observerCleanup?.then((fn) => fn?.()).catch(() => {});
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
        style={{ height: 250, width: "100%" }}
      />
    </div>
  );
}
