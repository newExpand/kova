import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { useProjectStore } from "../features/project";

interface GlobalShortcutsReturn {
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  isShortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean) => void;
}

export function useGlobalShortcuts(): GlobalShortcutsReturn {
  const navigate = useNavigate();
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isShortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
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
    // Cmd+K — Command palette (close shortcuts help first if open)
    if (e.metaKey && e.key === "k") {
      e.preventDefault();
      setShortcutsHelpOpen(false);
      setCommandPaletteOpen((prev) => !prev);
    }

    // Cmd+P — Focus file search input (opens panel if needed, switches to tree mode)
    if (e.metaKey && e.key === "p") {
      const hasProject = !!useProjectStore.getState().selectedId;
      if (hasProject) {
        e.preventDefault();
        const store = useAppStore.getState();
        store.setFileViewerPanelOpen(true);
        store.setFileViewerMode("tree");
        store.setFileFinderActive(true);
      }
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

    // Cmd+Shift+F — Search in Files (content search)
    if (e.metaKey && e.shiftKey && e.key === "f") {
      const hasProject = !!useProjectStore.getState().selectedId;
      if (hasProject) {
        e.preventDefault();
        const store = useAppStore.getState();
        store.setFileViewerPanelOpen(true);
        store.setFileViewerMode("search");
        store.setContentSearchActive(true);
      }
    }

    // Cmd+J — Toggle sidebar tab (Projects ↔ Agents)
    if (e.metaKey && e.key === "j") {
      e.preventDefault();
      const appState = useAppStore.getState();
      appState.setSidebarMode(appState.sidebarMode === "projects" ? "agents" : "projects");
    }

    // Cmd+B — Toggle sidebar visibility
    if (e.metaKey && e.key === "b") {
      e.preventDefault();
      useAppStore.getState().toggleSidebarHidden();
    }

    // Cmd+\ / Cmd+Shift+\ — Toggle file viewer panel / maximize
    if (e.metaKey && e.key === "\\") {
      const hasProject = !!useProjectStore.getState().selectedId;
      if (hasProject) {
        e.preventDefault();
        if (e.shiftKey) {
          useAppStore.getState().toggleFileViewerMaximize();
        } else {
          useAppStore.getState().toggleFileViewerPanel();
        }
      }
    }

    // Cmd+/ — Shortcuts help modal (close command palette first if open)
    if (e.metaKey && e.key === "/") {
      e.preventDefault();
      setCommandPaletteOpen(false);
      setShortcutsHelpOpen((prev) => !prev);
    }

    // Cmd+1~9, Cmd+0 — Quick project switch
    if (e.metaKey && !e.shiftKey && !e.altKey && e.key >= "0" && e.key <= "9") {
      const digit = parseInt(e.key, 10);
      const index = digit === 0 ? 9 : digit - 1;
      const store = useProjectStore.getState();
      const project = store.activeProjects()[index];
      if (project) {
        e.preventDefault();
        store.selectProject(project.id);
        navigate(`/projects/${project.id}/terminal`);
      }
    }
  }, [navigate]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    isShortcutsHelpOpen,
    setShortcutsHelpOpen,
  };
}
