import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Mock the Tauri API surfaces used by the app so component tests can render
 * without a Tauri runtime. Tests can override per-call with `vi.mocked(...)`.
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_app_version") return "0.1.0-test";
    if (cmd === "greet") return "Hello, world!";
    return null;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
