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

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "AppStore" },
  ),
);
