import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { useProjectStore } from "../features/project";

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

    // Cmd+\ — Toggle file viewer overlay panel
    if (e.metaKey && e.key === "\\") {
      const pathname = window.location.pathname;
      const hasProject = !!useProjectStore.getState().selectedId;
      // Skip if on /files route or no project selected
      if (!pathname.includes("/files") && hasProject) {
        e.preventDefault();
        useAppStore.getState().toggleFileViewerPanel();
      }
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
