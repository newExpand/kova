import { create } from "zustand";
import { devtools } from "zustand/middleware";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AppState {
  sidebarCollapsed: boolean;
  sidebarMode: "projects" | "sessions";
  currentRoute: string;
  isOnboarding: boolean;
  pendingProjectNavigation: string | null;
  isFileViewerPanelOpen: boolean;
  isFileFinderActive: boolean;
  fileViewerPanelWidth: number;
  fileViewerMode: "tree" | "search";
  isContentSearchActive: boolean;
  isFileViewerMaximized: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface AppActions {
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarMode: (mode: "projects" | "sessions") => void;
  setCurrentRoute: (route: string) => void;
  setOnboarding: (value: boolean) => void;
  setPendingProjectNavigation: (id: string | null) => void;
  toggleFileViewerPanel: () => void;
  setFileViewerPanelOpen: (open: boolean) => void;
  setFileFinderActive: (active: boolean) => void;
  setFileViewerPanelWidth: (width: number) => void;
  setFileViewerMode: (mode: "tree" | "search") => void;
  setContentSearchActive: (active: boolean) => void;
  toggleFileViewerMaximize: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Combined Store Type
// ---------------------------------------------------------------------------

type AppStore = AppState & AppActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: AppState = {
  sidebarCollapsed: false,
  sidebarMode: "projects",
  currentRoute: "/",
  isOnboarding: false,
  pendingProjectNavigation: null,
  isFileViewerPanelOpen: false,
  isFileFinderActive: false,
  fileViewerPanelWidth: 480,
  fileViewerMode: "tree",
  isContentSearchActive: false,
  isFileViewerMaximized: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      ...initialState,

      toggleSidebar: () =>
        set(
          (state) => ({ sidebarCollapsed: !state.sidebarCollapsed }),
          undefined,
          "toggleSidebar",
        ),

      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }, undefined, "setSidebarCollapsed"),

      setSidebarMode: (mode) =>
        set({ sidebarMode: mode }, undefined, "setSidebarMode"),

      setCurrentRoute: (route) =>
        set({ currentRoute: route }, undefined, "setCurrentRoute"),

      setOnboarding: (value) =>
        set({ isOnboarding: value }, undefined, "setOnboarding"),

      setPendingProjectNavigation: (id) =>
        set(
          { pendingProjectNavigation: id },
          undefined,
          "setPendingProjectNavigation",
        ),

      toggleFileViewerPanel: () =>
        set(
          (state) => {
            // Maximized → restore to split mode (don't close)
            if (state.isFileViewerPanelOpen && state.isFileViewerMaximized) {
              return { isFileViewerMaximized: false };
            }
            // Otherwise toggle panel open/close
            return {
              isFileViewerPanelOpen: !state.isFileViewerPanelOpen,
              isFileFinderActive: false,
              isContentSearchActive: false,
            };
          },
          undefined,
          "toggleFileViewerPanel",
        ),

      setFileViewerPanelOpen: (open) =>
        set(
          (state) => ({
            isFileViewerPanelOpen: open,
            isFileFinderActive: false,
            isContentSearchActive: false,
            isFileViewerMaximized: open ? state.isFileViewerMaximized : false,
          }),
          undefined,
          "setFileViewerPanelOpen",
        ),

      setFileFinderActive: (active) =>
        set({ isFileFinderActive: active }, undefined, "setFileFinderActive"),

      setFileViewerPanelWidth: (width) =>
        set(
          { fileViewerPanelWidth: Math.max(320, Math.min(width, 800)) },
          undefined,
          "setFileViewerPanelWidth",
        ),

      setFileViewerMode: (mode) =>
        set({ fileViewerMode: mode }, undefined, "setFileViewerMode"),

      setContentSearchActive: (active) =>
        set({ isContentSearchActive: active }, undefined, "setContentSearchActive"),

      toggleFileViewerMaximize: () =>
        set(
          (state) => {
            const closing = state.isFileViewerPanelOpen && state.isFileViewerMaximized;
            return {
              isFileViewerPanelOpen: !closing,
              isFileViewerMaximized: !closing,
              isFileFinderActive: false,
              isContentSearchActive: false,
            };
          },
          undefined,
          "toggleFileViewerMaximize",
        ),

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "AppStore" },
  ),
);
