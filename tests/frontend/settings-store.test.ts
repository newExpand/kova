/**
 * Settings Store Tests — notification_style 기본값 동기화
 *
 * 핵심 시나리오:
 * - DB에 값이 있으면 그대로 사용
 * - DB가 비어 있으면 alerter 유무에 따라 기본값 계산 + DB 저장
 * - 초기 저장 실패 시 UI는 계산된 값, rollback 기준은 백엔드 기본값("alert")
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

// ── Mocks (hoisted before imports) ────────────────────────────────────

vi.mock("../../src/lib/tauri/commands", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getAgentCommands: vi.fn(),
  setAgentCommandIpc: vi.fn(),
  AGENT_TYPES: {
    claudeCode: { label: "Claude Code", command: "claude" },
    codexCli: { label: "Codex CLI", command: "codex" },
    geminiCli: { label: "Gemini CLI", command: "gemini" },
  },
}));

vi.mock("../../src/features/environment", () => ({
  getCachedEnvironment: vi.fn(),
}));

vi.mock("../../src/features/terminal", () => ({
  DEFAULT_THEME_ID: "dracula",
  DEFAULT_FONT_ID: "jetbrains-mono",
  DEFAULT_FONT_SIZE: 14,
  FONT_SIZE_MIN: 8,
  FONT_SIZE_MAX: 32,
  getThemeById: () => ({ id: "dracula", xterm: {} }),
  applyThemeCSS: vi.fn(),
  updateGlassBgOverrides: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────

import { useSettingsStore } from "../../src/features/settings/stores/settingsStore";
import * as commands from "../../src/lib/tauri/commands";
import * as env from "../../src/features/environment";

const mockGetSetting = vi.mocked(commands.getSetting);
const mockSetSetting = vi.mocked(commands.setSetting);
const mockGetAgentCommands = vi.mocked(commands.getAgentCommands);
const mockGetCachedEnv = vi.mocked(env.getCachedEnvironment);

// ── Helpers ───────────────────────────────────────────────────────────

const MOCK_ENV_NO_ALERTER = {
  tmuxInstalled: true,
  tmuxVersion: "3.4",
  claudeCodeInstalled: true,
  claudeCodeVersion: "1.0.0",
  codexCliInstalled: false,
  codexCliVersion: null,
  geminiCliInstalled: false,
  geminiCliVersion: null,
  gitInstalled: true,
  gitVersion: "2.43.0",
  alerterInstalled: false,
  shellType: "/bin/zsh",
};

const MOCK_ENV_WITH_ALERTER = {
  ...MOCK_ENV_NO_ALERTER,
  alerterInstalled: true,
};

/** Set up getSetting to return given notification_style, defaults for others */
function mockSettingsWithStyle(notifStyle: string) {
  mockGetSetting.mockImplementation((key: string, def: string) => {
    if (key === "notification_style") return Promise.resolve(notifStyle);
    return Promise.resolve(def);
  });
  mockGetAgentCommands.mockResolvedValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("SettingsStore — notification_style defaults", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── 시나리오 1: DB에 값이 있으면 그대로 사용 ───────────────────────
  it("uses existing DB value without calling setSetting", async () => {
    mockSettingsWithStyle("banner");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    const state = useSettingsStore.getState();
    expect(state.notificationStyle).toBe("banner");
    expect(state.isLoading).toBe(false);
    // setSetting should NOT be called — DB already has a value
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  // ── 시나리오 2: DB 비어있음 + alerter 없음 + 저장 성공 ────────────
  it("computes 'banner' default when alerter missing and persists to DB", async () => {
    mockSettingsWithStyle("");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_NO_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    const state = useSettingsStore.getState();
    expect(state.notificationStyle).toBe("banner");
    expect(state.alerterInstalled).toBe(false);
    // setSetting should persist the computed default
    expect(mockSetSetting).toHaveBeenCalledWith("notification_style", "banner");
  });

  // ── 시나리오 2b: DB 비어있음 + alerter 있음 → "alert" 기본값 ──────
  it("computes 'alert' default when alerter is installed", async () => {
    mockSettingsWithStyle("");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    const state = useSettingsStore.getState();
    expect(state.notificationStyle).toBe("alert");
    expect(state.alerterInstalled).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith("notification_style", "alert");
  });

  // ── 시나리오 3: DB 비어있음 + alerter 없음 + 저장 실패 ────────────
  // 핵심 테스트: UI는 banner(올바른 UX), rollback 기준은 alert(DB 실제 상태)
  it("on initial write failure: UI shows banner, rollback baseline is backend default 'alert'", async () => {
    mockSettingsWithStyle("");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_NO_ALERTER);
    // 초기 기본값 저장 실패
    mockSetSetting.mockRejectedValueOnce(new Error("DB write failed"));

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    // UI는 계산된 "banner"를 표시 — alerter가 없는 환경에서 올바른 UX
    expect(useSettingsStore.getState().notificationStyle).toBe("banner");

    // rollback 기준 간접 검증:
    // setNotificationStyle을 실패시키면 getPersistedValue → "alert"로 rollback
    mockSetSetting.mockRejectedValueOnce(new Error("second failure"));

    await act(async () => {
      await useSettingsStore.getState().setNotificationStyle("alert");
    });

    // rollback 결과 = "alert" (백엔드의 하드코딩 기본값, DB 실제 상태와 일치)
    expect(useSettingsStore.getState().notificationStyle).toBe("alert");
  });

  // ── 시나리오 3b: 저장 성공 후 rollback은 저장된 값으로 ──────────────
  it("on initial write success: rollback baseline matches persisted value", async () => {
    mockSettingsWithStyle("");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_NO_ALERTER);
    mockSetSetting.mockResolvedValueOnce(undefined); // 초기 저장 성공

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    expect(useSettingsStore.getState().notificationStyle).toBe("banner");

    // 사용자 변경 시도 → 실패 → rollback은 "banner" (초기에 성공적으로 저장된 값)
    mockSetSetting.mockRejectedValueOnce(new Error("save failed"));

    await act(async () => {
      await useSettingsStore.getState().setNotificationStyle("alert");
    });

    expect(useSettingsStore.getState().notificationStyle).toBe("banner");
  });

  // ── 환경 체크 실패 시 graceful degradation ─────────────────────────
  it("falls back to 'alert' when environment check fails entirely", async () => {
    mockSettingsWithStyle("");
    mockGetCachedEnv.mockRejectedValue(new Error("IPC error"));
    mockSetSetting.mockResolvedValue(undefined);

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    const state = useSettingsStore.getState();
    // alerter 감지 불가 → detectedAlerter === null → defaultStyle = "alert"
    expect(state.notificationStyle).toBe("alert");
    expect(state.alerterInstalled).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});

// ── Agent Commands ──────────────────────────────────────────────────

const mockSetAgentCommand = vi.mocked(commands.setAgentCommandIpc);

describe("SettingsStore — agent commands", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    vi.clearAllMocks();
  });

  it("fetches agent commands and populates state during fetchSettings", async () => {
    mockSettingsWithStyle("alert");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);
    mockGetAgentCommands.mockResolvedValue([
      { agentType: "claudeCode", label: "Claude Code", command: "/custom/claude", defaultCommand: "claude" },
      { agentType: "codexCli", label: "Codex CLI", command: "codex", defaultCommand: "codex" },
      { agentType: "geminiCli", label: "Gemini CLI", command: "gemini", defaultCommand: "gemini" },
    ]);

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    const state = useSettingsStore.getState();
    expect(state.agentCommands.claudeCode.command).toBe("/custom/claude");
    expect(state.agentCommands.codexCli.command).toBe("codex");
  });

  it("uses default commands when getAgentCommands fails", async () => {
    mockSettingsWithStyle("alert");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);
    mockGetAgentCommands.mockRejectedValue(new Error("DB error"));

    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    const state = useSettingsStore.getState();
    // Should use AGENT_TYPES defaults
    expect(state.agentCommands.claudeCode.command).toBe("claude");
    expect(state.agentCommands.codexCli.command).toBe("codex");
    expect(state.isLoading).toBe(false);
  });

  it("persists agent command on setAgentCommand success", async () => {
    // First fetch to initialize
    mockSettingsWithStyle("alert");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);
    mockGetAgentCommands.mockResolvedValue([]);
    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    // Set custom command
    mockSetAgentCommand.mockResolvedValue(undefined);

    await act(async () => {
      await useSettingsStore.getState().setAgentCommand("claudeCode", "/usr/local/bin/claude");
    });

    const state = useSettingsStore.getState();
    expect(state.agentCommands.claudeCode.command).toBe("/usr/local/bin/claude");
    expect(state.isLoading).toBe(false);
    expect(mockSetAgentCommand).toHaveBeenCalledWith("claudeCode", "/usr/local/bin/claude");
  });

  it("rolls back to persisted value on setAgentCommand failure", async () => {
    // Fetch with initial command
    mockSettingsWithStyle("alert");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);
    mockGetAgentCommands.mockResolvedValue([
      { agentType: "claudeCode", label: "Claude Code", command: "claude", defaultCommand: "claude" },
    ]);
    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    // Attempt to set custom command — fails
    mockSetAgentCommand.mockRejectedValue(new Error("DB write failed"));

    await act(async () => {
      await useSettingsStore.getState().setAgentCommand("claudeCode", "/bad/path");
    });

    // Should rollback to persisted value
    const state = useSettingsStore.getState();
    expect(state.agentCommands.claudeCode.command).toBe("claude");
    expect(state.error).toBe("DB write failed");
  });

  it("uses defaultCommand when empty string is passed to setAgentCommand", async () => {
    mockSettingsWithStyle("alert");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);
    mockGetAgentCommands.mockResolvedValue([]);
    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    mockSetAgentCommand.mockResolvedValue(undefined);

    await act(async () => {
      await useSettingsStore.getState().setAgentCommand("claudeCode", "   ");
    });

    // Empty string should resolve to defaultCommand
    expect(mockSetAgentCommand).toHaveBeenCalledWith("claudeCode", "claude");
    expect(useSettingsStore.getState().agentCommands.claudeCode.command).toBe("claude");
  });

  it("delegates to setAgentCommand with defaultCommand on resetAgentCommand", async () => {
    mockSettingsWithStyle("alert");
    mockGetCachedEnv.mockResolvedValue(MOCK_ENV_WITH_ALERTER);
    mockSetSetting.mockResolvedValue(undefined);
    mockGetAgentCommands.mockResolvedValue([]);
    await act(async () => {
      await useSettingsStore.getState().fetchSettings();
    });

    mockSetAgentCommand.mockResolvedValue(undefined);

    await act(async () => {
      useSettingsStore.getState().resetAgentCommand("claudeCode");
    });

    // Should call setAgentCommandIpc with the default
    expect(mockSetAgentCommand).toHaveBeenCalledWith("claudeCode", "claude");
  });
});
