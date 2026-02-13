/**
 * Notification Store Tests — PLAN.md Feature: 네이티브 알림 + 히스토리
 *
 * Tests:
 * - Notification fetch from backend
 * - Realtime event push (from event bridge)
 * - Unread count tracking
 * - Panel open/close
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

vi.mock("../../src/lib/tauri/commands", () => ({
  listProjectNotifications: vi.fn(),
}));

import { useNotificationStore } from "../../src/features/notification/stores/notificationStore";
import * as commands from "../../src/lib/tauri/commands";
import type { NotificationRecord } from "../../src/lib/tauri/commands";

const mockCommands = vi.mocked(commands);

const MOCK_NOTIFICATION: NotificationRecord = {
  id: "notif-1",
  projectId: "proj-1",
  eventType: "Notification",
  title: "Task completed",
  message: "All tests passed",
  payload: null,
  createdAt: "2024-01-01T10:30:00Z",
};

const MOCK_NOTIFICATION_2: NotificationRecord = {
  id: "notif-2",
  projectId: "proj-1",
  eventType: "Stop",
  title: "Agent stopped",
  message: null,
  payload: null,
  createdAt: "2024-01-01T10:32:00Z",
};

describe("NotificationStore", () => {
  beforeEach(() => {
    useNotificationStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── Feature: 알림 히스토리 조회 ────────────────────────────────────
  describe("fetchNotifications", () => {
    it("should fetch notifications for a project", async () => {
      mockCommands.listProjectNotifications.mockResolvedValue([
        MOCK_NOTIFICATION,
        MOCK_NOTIFICATION_2,
      ]);

      await act(async () => {
        await useNotificationStore
          .getState()
          .fetchNotifications("proj-1", 50);
      });

      const state = useNotificationStore.getState();
      expect(state.notifications).toHaveLength(2);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockCommands.listProjectNotifications).toHaveBeenCalledWith(
        "proj-1",
        50,
      );
    });

    it("should set isLoading during fetch", async () => {
      let loadingDuringFetch = false;
      mockCommands.listProjectNotifications.mockImplementation(async () => {
        loadingDuringFetch = useNotificationStore.getState().isLoading;
        return [];
      });

      await act(async () => {
        await useNotificationStore
          .getState()
          .fetchNotifications("proj-1", 50);
      });

      expect(loadingDuringFetch).toBe(true);
      expect(useNotificationStore.getState().isLoading).toBe(false);
    });

    it("should handle fetch errors gracefully", async () => {
      mockCommands.listProjectNotifications.mockRejectedValue(
        new Error("DB error"),
      );

      await act(async () => {
        await useNotificationStore
          .getState()
          .fetchNotifications("proj-1", 50);
      });

      const state = useNotificationStore.getState();
      expect(state.error).toBe("DB error");
      expect(state.isLoading).toBe(false);
    });
  });

  // ── Feature: 실시간 Hook 이벤트 ───────────────────────────────────
  describe("pushRealtimeEvent", () => {
    it("should add realtime event to front of list", () => {
      const event1 = {
        projectPath: "/test",
        eventType: "Notification",
        payload: {},
        timestamp: "2024-01-01T10:30:00Z",
      };
      const event2 = {
        projectPath: "/test",
        eventType: "Stop",
        payload: {},
        timestamp: "2024-01-01T10:32:00Z",
      };

      act(() => {
        useNotificationStore.getState().pushRealtimeEvent(event1);
      });
      act(() => {
        useNotificationStore.getState().pushRealtimeEvent(event2);
      });

      const state = useNotificationStore.getState();
      expect(state.realtimeEvents).toHaveLength(2);
      expect(state.realtimeEvents[0].eventType).toBe("Stop"); // newest first
      expect(state.realtimeEvents[1].eventType).toBe("Notification");
    });

    it("should increment unread count", () => {
      const event = {
        projectPath: "/test",
        eventType: "Notification",
        payload: {},
        timestamp: "2024-01-01T00:00:00Z",
      };

      act(() => {
        useNotificationStore.getState().pushRealtimeEvent(event);
        useNotificationStore.getState().pushRealtimeEvent(event);
        useNotificationStore.getState().pushRealtimeEvent(event);
      });

      expect(useNotificationStore.getState().unreadCount).toBe(3);
    });

    it("should cap realtime events at 100", () => {
      for (let i = 0; i < 110; i++) {
        act(() => {
          useNotificationStore.getState().pushRealtimeEvent({
            projectPath: "/test",
            eventType: "Notification",
            payload: {},
            timestamp: `2024-01-01T00:${String(i).padStart(2, "0")}:00Z`,
          });
        });
      }

      expect(useNotificationStore.getState().realtimeEvents).toHaveLength(100);
    });
  });

  // ── Feature: 알림 패널 UI ─────────────────────────────────────────
  describe("panel controls", () => {
    it("should toggle panel open/close", () => {
      expect(useNotificationStore.getState().isPanelOpen).toBe(false);

      act(() => {
        useNotificationStore.getState().togglePanel();
      });
      expect(useNotificationStore.getState().isPanelOpen).toBe(true);

      act(() => {
        useNotificationStore.getState().togglePanel();
      });
      expect(useNotificationStore.getState().isPanelOpen).toBe(false);
    });

    it("should mark all as read", () => {
      // Push some events to get unread count
      act(() => {
        useNotificationStore.getState().pushRealtimeEvent({
          projectPath: "/test",
          eventType: "Notification",
          payload: {},
          timestamp: "2024-01-01T00:00:00Z",
        });
      });

      expect(useNotificationStore.getState().unreadCount).toBe(1);

      act(() => {
        useNotificationStore.getState().markAllRead();
      });

      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────
  describe("reset", () => {
    it("should reset to initial state", () => {
      useNotificationStore.setState({
        notifications: [MOCK_NOTIFICATION],
        realtimeEvents: [
          {
            projectPath: "/test",
            eventType: "X",
            payload: {},
            timestamp: "",
          },
        ],
        isLoading: true,
        error: "some error",
        unreadCount: 5,
        isPanelOpen: true,
      });

      act(() => {
        useNotificationStore.getState().reset();
      });

      const state = useNotificationStore.getState();
      expect(state.notifications).toEqual([]);
      expect(state.realtimeEvents).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.unreadCount).toBe(0);
      expect(state.isPanelOpen).toBe(false);
    });
  });
});
