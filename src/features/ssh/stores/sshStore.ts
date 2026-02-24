import { create } from "zustand";
import type {
  SshConnection,
  CreateSshConnectionInput,
  UpdateSshConnectionInput,
  SshConnectResult,
  SshTestResult,
} from "../../../lib/tauri/commands";
import {
  listSshConnections,
  listSshConnectionsByProject,
  createSshConnection,
  updateSshConnection,
  deleteSshConnection,
  connectSshSession,
  killTmuxSession,
  testSshConnection,
} from "../../../lib/tauri/commands";

interface SshState {
  // 1. State
  connections: SshConnection[];
  activeConnections: Record<string, SshConnectResult>;
  isLoading: boolean;
  error: string | null;

  // 2. Computed
  getConnectionById: (id: string) => SshConnection | undefined;
  getConnectionsByProject: (projectId: string) => SshConnection[];
  isConnectionActive: (id: string) => boolean;
  getActiveResult: (id: string) => SshConnectResult | undefined;

  // 3. Actions
  fetchConnections: () => Promise<void>;
  fetchConnectionsByProject: (projectId: string) => Promise<void>;
  createConnection: (
    input: CreateSshConnectionInput,
  ) => Promise<SshConnection>;
  updateConnection: (
    id: string,
    input: UpdateSshConnectionInput,
  ) => Promise<SshConnection>;
  deleteConnection: (id: string) => Promise<void>;
  connectSession: (id: string) => Promise<SshConnectResult>;
  disconnectSession: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<SshTestResult>;

  // 4. Reset
  reset: () => void;
}

const initialState = {
  connections: [] as SshConnection[],
  activeConnections: {} as Record<string, SshConnectResult>,
  isLoading: false,
  error: null as string | null,
};

export const useSshStore = create<SshState>()((set, get) => ({
  ...initialState,

  // Computed
  getConnectionById: (id) => get().connections.find((c) => c.id === id),
  getConnectionsByProject: (projectId) =>
    get().connections.filter((c) => c.projectId === projectId),
  isConnectionActive: (id) => id in get().activeConnections,
  getActiveResult: (id) => get().activeConnections[id],

  // Actions
  fetchConnections: async () => {
    set({ isLoading: true, error: null });
    try {
      const connections = await listSshConnections();
      set((state) => {
        const ids = new Set(connections.map((c) => c.id));
        const cleaned: Record<string, SshConnectResult> = {};
        for (const [k, v] of Object.entries(state.activeConnections)) {
          if (ids.has(k)) cleaned[k] = v;
        }
        return { connections, activeConnections: cleaned };
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  fetchConnectionsByProject: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const projectConnections = await listSshConnectionsByProject(projectId);
      set((state) => {
        const others = state.connections.filter(
          (c) => c.projectId !== projectId,
        );
        return { connections: [...others, ...projectConnections] };
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  createConnection: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const connection = await createSshConnection(input);
      set((state) => ({
        connections: [connection, ...state.connections],
      }));
      return connection;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  updateConnection: async (id, input) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await updateSshConnection(id, input);
      set((state) => ({
        connections: state.connections.map((c) =>
          c.id === id ? updated : c,
        ),
      }));
      return updated;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteConnection: async (id) => {
    set({ isLoading: true, error: null });
    try {
      // Kill associated tmux session if active
      const activeResult = get().activeConnections[id];
      if (activeResult) {
        try {
          await killTmuxSession(activeResult.sessionName);
        } catch {
          // Session may already be gone — proceed with deletion
        }
      }
      await deleteSshConnection(id);
      set((state) => {
        const { [id]: _, ...remaining } = state.activeConnections;
        return {
          connections: state.connections.filter((c) => c.id !== id),
          activeConnections: remaining,
        };
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  connectSession: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await connectSshSession(id);
      set((state) => ({
        activeConnections: { ...state.activeConnections, [id]: result },
      }));
      return result;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  disconnectSession: async (id) => {
    const result = get().activeConnections[id];
    if (!result) return;
    set({ isLoading: true, error: null });
    try {
      await killTmuxSession(result.sessionName);
    } catch (e) {
      const msg = String(e);
      // Suppress expected "session not found" errors
      if (!msg.includes("not found") && !msg.includes("no server running")) {
        console.error(`[SSH] Failed to kill session '${result.sessionName}':`, e);
        set({ error: `Failed to disconnect: ${msg}` });
      }
    } finally {
      // Always remove from active connections — session may already be gone
      set((state) => {
        const { [id]: _, ...remaining } = state.activeConnections;
        return { activeConnections: remaining, isLoading: false };
      });
    }
  },

  testConnection: async (id) => {
    set({ error: null });
    try {
      return await testSshConnection(id);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  // Reset
  reset: () => set(initialState),
}));
