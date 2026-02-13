/// <reference types="vitest/globals" />
import "@testing-library/jest-dom/vitest";

// Mock Tauri internals for frontend tests
// This enables @tauri-apps/api/mocks to work properly

const mockInvoke = vi.fn();
const mockTransformCallback = vi.fn((callback: unknown) => {
  const id = Math.random();
  (window as Record<string, unknown>)[`_${id}`] = callback;
  return id;
});

// Set up __TAURI_INTERNALS__ before any Tauri API imports
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke: mockInvoke,
    transformCallback: mockTransformCallback,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    convertFileSrc: (path: string) => path,
  },
  writable: true,
  configurable: true,
});

// Reset all mocks between tests
afterEach(() => {
  vi.restoreAllMocks();
  mockInvoke.mockReset();
});
