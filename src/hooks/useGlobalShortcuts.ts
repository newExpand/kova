import { useEffect, useState, useCallback } from "react";

interface GlobalShortcutsReturn {
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export function useGlobalShortcuts(): GlobalShortcutsReturn {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);

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
