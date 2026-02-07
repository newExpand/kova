import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface AppState {
  // State
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  onboardingComplete: boolean;

  // Computed
  getEffectiveSidebarWidth: () => number;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  completeOnboarding: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  sidebarCollapsed: false,
  sidebarWidth: 240,
  onboardingComplete: false,
};

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        getEffectiveSidebarWidth: () => {
          return get().sidebarCollapsed ? 60 : get().sidebarWidth;
        },

        toggleSidebar: () => {
          set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
        },

        setSidebarCollapsed: (collapsed: boolean) => {
          set({ sidebarCollapsed: collapsed });
        },

        completeOnboarding: () => {
          set({ onboardingComplete: true });
        },

        reset: () => {
          set(initialState);
        },
      }),
      { name: "flow-orche-app" },
    ),
  ),
);
