import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { initI18n } from "../i18n";

// Boot i18next once for the whole test suite. Without this, every
// `useTranslation()` consumer renders raw keys ("sidebar.nav.settings")
// which breaks the existing `getByText("Settings")` queries.
initI18n("en");

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
        ctime: null,
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
    if (cmd === "fs_find") return [];
    if (cmd === "conn_list") return [];
    if (cmd === "conn_create_sftp") return "test-conn-id";
    if (cmd === "conn_disconnect") return null;
    if (cmd === "ssh_config_hosts") return [];
    if (cmd === "conn_mkdir") return null;
    if (cmd === "conn_rename") return null;
    if (cmd === "conn_remove") return null;
    if (cmd === "conn_known_hosts_list") return [];
    if (cmd === "conn_known_hosts_remove") return null;
    if (cmd === "conn_hash_sha256") return "deadbeefremote";
    if (cmd === "sync_list") return [];
    if (cmd === "sync_start_local") return "test-job-id";
    if (cmd === "sync_start_repo") return "test-repo-job-id";
    if (cmd === "sync_start_cross") return "test-cross-job-id";
    if (cmd === "sync_cpstamp") return "/dest/file.txt.2026_05_06_13_45";
    if (cmd === "sync_dedup") {
      return {
        scanned: 5,
        duplicates: 1,
        bytesFreed: 2048,
        recycleBin: "/path/_recycleBin",
      };
    }
    if (cmd === "sync_cancel") return null;
    if (cmd === "sync_pause") return null;
    if (cmd === "sync_resume") return null;
    if (cmd === "sync_resolve_conflict") return null;
    if (cmd === "fs_trash") return null;
    if (cmd === "fs_trash_many") return null;
    if (cmd === "fs_reveal_in_os") return null;
    if (cmd === "fs_open_with_default") return null;
    if (cmd === "fs_open_in_terminal") return null;
    if (cmd === "fs_hash_sha256") return "deadbeef";
    if (cmd === "fs_mounts") return [];
    if (cmd === "fs_create_empty_file") return null;
    if (cmd === "fs_compress_zip") return null;
    if (cmd === "fs_extract_zip") return null;
    if (cmd === "fs_copy_recursive") return null;
    if (cmd === "fs_trash_path") return "/home/test/.Trash";
    if (cmd === "fs_image_rotate") return null;
    if (cmd === "fs_image_exif") {
      return {
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        lens: null,
        iso: null,
        exposure: null,
        aperture: null,
        focalLength: null,
      };
    }
    if (cmd === "fs_disk_space") {
      // 1 TB partition with 250 GB free.
      return { total: 1024 * 1024 * 1024 * 1024, free: 250 * 1024 * 1024 * 1024 };
    }
    if (cmd === "settings_load") return null;
    if (cmd === "settings_save") return null;
    if (cmd === "settings_app_data_dir") return "/test/app-data-dir";
    if (cmd === "crash_logs_dir") return "/test/app-data-dir/crashes";
    if (cmd === "crash_logs_count") return 0;
    return null;
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  // BrowserTabs imports this to mirror the active path into the OS
  // window title. Tests don't need the real window — return a stub
  // so the dynamic import resolves cleanly.
  getCurrentWindow: () => ({
    setTitle: vi.fn(async () => {}),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  // listen returns an unlisten fn; default to a no-op so mount/unmount
  // doesn't blow up when components subscribe to drag-drop or sync events.
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
