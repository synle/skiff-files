import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Mock the Tauri API surfaces used by the app so component tests can render
 * without a Tauri runtime. Tests can override per-call with `vi.mocked(...)`.
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, _args?: Record<string, unknown>) => {
    // Default mock: enough to keep components from throwing during smoke tests.
    // Individual tests override per-call via vi.mocked(invoke).mockImplementation.
    if (cmd === "get_app_version") return "0.1.0-test";
    if (cmd === "fs_home_dir") return "/home/test";
    if (cmd === "fs_list_dir") return [];
    if (cmd === "fs_canonicalize") return _args?.path ?? "/";
    if (cmd === "fs_stat") {
      return {
        name: "test",
        path: _args?.path ?? "/",
        kind: "folder",
        size: 0,
        mtime: null,
        isDir: true,
        isSymlink: false,
        isHidden: false,
        mode: null,
      };
    }
    if (cmd === "fs_read_text") return "preview text";
    if (cmd === "fs_read_base64") {
      // Tiny 1x1 transparent PNG so jsdom's image element doesn't choke.
      return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
    }
    if (cmd === "fs_dir_summary") {
      return { entries: 42, totalSize: 1024, truncated: false };
    }
    return null;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
