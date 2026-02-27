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
          (state) => ({
            isFileViewerPanelOpen: !state.isFileViewerPanelOpen,
            isFileFinderActive: false,
          }),
          undefined,
          "toggleFileViewerPanel",
        ),

      setFileViewerPanelOpen: (open) =>
        set(
          { isFileViewerPanelOpen: open, isFileFinderActive: false },
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

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "AppStore" },
  ),
);
