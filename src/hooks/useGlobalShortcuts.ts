import { useEffect, useRef, useState, useCallback } from "react";

interface GlobalShortcutsReturn {
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export function useGlobalShortcuts(): GlobalShortcutsReturn {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (prevOpenRef.current && !isCommandPaletteOpen) {
      requestAnimationFrame(() => {
        const textarea = document.querySelector(
          ".xterm-helper-textarea",
        ) as HTMLTextAreaElement | null;
        textarea?.focus();
      });
    }
    prevOpenRef.current = isCommandPaletteOpen;
  }, [isCommandPaletteOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Cmd+K — Command palette
    if (e.metaKey && e.key === "k") {
      e.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
    }

    // Cmd+N — New project (dispatches custom event for Sidebar to handle)
    if (e.metaKey && e.key === "n") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("flow-orche:new-project"));
    }

    // Cmd+Shift+G — Toggle Terminal ↔ Git Graph
    if (e.metaKey && e.shiftKey && e.key === "g") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("flow-orche:toggle-git"));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
  };
}
