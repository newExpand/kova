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
  killPty,
  testSshConnection,
} from "../../../lib/tauri/commands";

interface SshState {
  // 1. State
  connections: SshConnection[];
  activeConnections: Record<string, SshConnectResult>;
  /** PTY pids for SSH direct mode connections (for cleanup when TerminalPage is unmounted) */
  sshPtyPids: Record<string, number>;
  /** Pre-warmed tmux availability results (populated by sidebar background probe) */
  tmuxCheckCache: Record<string, boolean | null>;
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
  /** Register PTY pid for SSH direct mode (called by TerminalPage after PTY spawn) */
  registerSshPtyPid: (connectionId: string, pid: number) => void;
  /** Update remote tmux availability in active connection (for navigation cache) */
  updateRemoteTmuxAvailable: (connectionId: string, value: boolean | null) => void;
  /** Cache pre-warmed tmux check result (called by Sidebar background probe) */
  cacheTmuxCheck: (connectionId: string, value: boolean | null) => void;

  // 4. Reset
  reset: () => void;
}

const initialState = {
  connections: [] as SshConnection[],
  activeConnections: {} as Record<string, SshConnectResult>,
  sshPtyPids: {} as Record<string, number>,
  tmuxCheckCache: {} as Record<string, boolean | null>,
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
      // Kill associated local tmux session if active (connect_with_profile mode only)
      const activeResult = get().activeConnections[id];
      if (activeResult?.sessionName) {
        try {
          await killTmuxSession(activeResult.sessionName);
        } catch (e) {
          const msg = String(e);
          if (!msg.includes("not found") && !msg.includes("no server running")) {
            console.warn(
              `[SSH] Unexpected error killing session '${activeResult.sessionName}' during delete:`,
              e,
            );
          }
        }
      } else if (activeResult) {
        // SSH direct mode: kill PTY process directly
        const pid = get().sshPtyPids[id];
        if (pid != null && pid >= 0) {
          try {
            await killPty(pid);
          } catch (e) {
            const msg = String(e);
            if (!msg.includes("Unavailable pid") && !msg.includes("No such process")) {
              console.warn(`[SSH] Unexpected error killing PTY pid ${pid} during delete:`, e);
            }
          }
        }
      }
      await deleteSshConnection(id);
      set((state) => {
        const { [id]: _, ...remainConn } = state.activeConnections;
        const { [id]: __, ...remainPids } = state.sshPtyPids;
        return {
          connections: state.connections.filter((c) => c.id !== id),
          activeConnections: remainConn,
          sshPtyPids: remainPids,
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
      // Merge pre-warmed tmux check result if available
      const cachedTmux = get().tmuxCheckCache[id];
      if (result.remoteTmuxAvailable == null && cachedTmux != null) {
        result.remoteTmuxAvailable = cachedTmux;
      }
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
      if (result.sessionName) {
        // connect_with_profile mode: kill local tmux session
        await killTmuxSession(result.sessionName);
      } else {
        // SSH direct mode: kill PTY process directly (handles unmounted TerminalPage)
        const pid = get().sshPtyPids[id];
        if (pid != null && pid >= 0) {
          try {
            await killPty(pid);
          } catch (e) {
            const msg = String(e);
            if (!msg.includes("Unavailable pid") && !msg.includes("No such process")) {
              console.warn(`[SSH] Unexpected error killing PTY pid ${pid}:`, e);
            }
          }
        }
      }
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("not found") && !msg.includes("no server running")) {
        console.error(`[SSH] Failed to disconnect '${result.connectionName}':`, e);
        set({ error: `Failed to disconnect: ${msg}` });
      }
    } finally {
      set((state) => {
        const { [id]: _, ...remainConn } = state.activeConnections;
        const { [id]: __, ...remainPids } = state.sshPtyPids;
        return { activeConnections: remainConn, sshPtyPids: remainPids, isLoading: false };
      });
    }
  },

  registerSshPtyPid: (connectionId, pid) => {
    set((state) => ({
      sshPtyPids: { ...state.sshPtyPids, [connectionId]: pid },
    }));
  },

  cacheTmuxCheck: (connectionId, value) => {
    set((state) => ({
      tmuxCheckCache: { ...state.tmuxCheckCache, [connectionId]: value },
    }));
  },

  updateRemoteTmuxAvailable: (connectionId, value) => {
    set((state) => {
      const result = state.activeConnections[connectionId];
      if (!result) return state;
      return {
        activeConnections: {
          ...state.activeConnections,
          [connectionId]: { ...result, remoteTmuxAvailable: value },
        },
      };
    });
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
