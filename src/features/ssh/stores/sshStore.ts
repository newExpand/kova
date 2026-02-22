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
  connectSsh,
  testSshConnection,
} from "../../../lib/tauri/commands";

interface SshState {
  // 1. State
  connections: SshConnection[];
  activeConnectionId: string | null;
  isLoading: boolean;
  error: string | null;

  // 2. Computed
  getConnectionById: (id: string) => SshConnection | undefined;
  getConnectionsByProject: (projectId: string) => SshConnection[];

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
  connect: (id: string, sessionName: string) => Promise<SshConnectResult>;
  disconnect: () => void;
  testConnection: (id: string) => Promise<SshTestResult>;

  // 4. Reset
  reset: () => void;
}

const initialState = {
  connections: [] as SshConnection[],
  activeConnectionId: null as string | null,
  isLoading: false,
  error: null as string | null,
};

export const useSshStore = create<SshState>((set, get) => ({
  ...initialState,

  // Computed
  getConnectionById: (id) => get().connections.find((c) => c.id === id),
  getConnectionsByProject: (projectId) =>
    get().connections.filter((c) => c.projectId === projectId),

  // Actions
  fetchConnections: async () => {
    set({ isLoading: true, error: null });
    try {
      const connections = await listSshConnections();
      // Clear stale activeConnectionId if the connection no longer exists
      set((state) => {
        const ids = new Set(connections.map((c) => c.id));
        return {
          connections,
          activeConnectionId:
            state.activeConnectionId && ids.has(state.activeConnectionId)
              ? state.activeConnectionId
              : null,
        };
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
      // Merge: replace project connections, keep others
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
      await deleteSshConnection(id);
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== id),
        activeConnectionId:
          state.activeConnectionId === id ? null : state.activeConnectionId,
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  connect: async (id, sessionName) => {
    set({ error: null });
    try {
      const result = await connectSsh(id, sessionName);
      set({ activeConnectionId: id });
      return result;
    } catch (e) {
      set({ error: String(e), activeConnectionId: null });
      throw e;
    }
  },

  disconnect: () => {
    set({ activeConnectionId: null });
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
