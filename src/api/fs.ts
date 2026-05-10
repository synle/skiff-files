// Typed wrapper around the Rust fs commands. Centralizing them here keeps
// `invoke` calls — and their string command names — in one place, so command
// renames are a single-file refactor instead of a global grep.
import { invoke } from "@tauri-apps/api/core";

/** Mirror of `crate::fs::types::FileKind` (camelCase via serde). */
export type FileKind =
  | "folder"
  | "symlink"
  | "text"
  | "code"
  | "markdown"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "binary"
  | "unknown";

/** Mirror of `crate::fs::types::Entry`. `mtime` is unix seconds (UTC). */
export interface Entry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  mtime: number | null;
  /** Unix seconds for file creation / birth time. `null` on platforms
   *  / filesystems that don't expose it (Linux ext4 in some configs,
   *  SFTP — the protocol doesn't carry creation time). UI hides the
   *  Created column for entries with a null value. Optional for
   *  backwards compatibility with test fixtures predating ctime. */
  ctime?: number | null;
  isDir: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  /** Permission bits — `null` on Windows where the concept doesn't map. */
  mode: number | null;
}

/** Mirror of `crate::fs::types::ListOptions`. */
export interface ListOptions {
  showHidden?: boolean;
}

// Each wrapper is a one-liner — they exist purely to give the rest of the app
// a typed function surface instead of stringly-typed `invoke` calls scattered
// through components.

export const getAppVersion = (): Promise<string> =>
  invoke<string>("get_app_version");

export const fsHomeDir = (): Promise<string> => invoke<string>("fs_home_dir");

/** Spawn a new top-level Skiff Files window. Used by the Cmd/Ctrl+N
 *  shortcut so the user can hold multiple windows open against the
 *  same install. Resolves once the window has been created. */
export const windowOpenNew = (): Promise<void> =>
  invoke<void>("window_open_new");

/** Spawn a new window pre-seeded at `path`. The Rust side encodes
 *  the path into the URL fragment (`#path=<urlEncoded>`) so the
 *  fresh window's BrowserTabs can pick it up at boot. */
export const windowOpenAt = (path: string): Promise<void> =>
  invoke<void>("window_open_at", { path });

/** Re-target the local fs watcher at `path`. The Rust side emits
 *  debounced `fs:changed` events when anything inside changes, so the
 *  Browser can auto-refresh without polling. Call on every navigation
 *  (Browser does this in a useEffect tied to `path`). Errors silently
 *  — a watcher failure shouldn't block navigation. */
export const fsWatchSet = (path: string): Promise<void> =>
  invoke<void>("fs_watch_set", { path });

/** Stop the watcher. Called when navigating to a remote (`sftp://…`)
 *  path where local fs notifications don't apply. */
export const fsWatchClear = (): Promise<void> =>
  invoke<void>("fs_watch_clear");

export const fsListDir = (
  path: string,
  options?: ListOptions,
): Promise<Entry[]> => invoke<Entry[]>("fs_list_dir", { path, options });

export const fsStat = (path: string): Promise<Entry> =>
  invoke<Entry>("fs_stat", { path });

export const fsMkdir = (path: string): Promise<void> =>
  invoke<void>("fs_mkdir", { path });

export const fsRename = (from: string, to: string): Promise<void> =>
  invoke<void>("fs_rename", { from, to });

export const fsRemove = (path: string): Promise<void> =>
  invoke<void>("fs_remove", { path });

/** Send a single path to the OS trash. Cross-platform. */
export const fsTrash = (path: string): Promise<void> =>
  invoke<void>("fs_trash", { path });

/** Multi-path trash — one IPC round-trip for a multi-selection delete. */
export const fsTrashMany = (paths: string[]): Promise<void> =>
  invoke<void>("fs_trash_many", { paths });

/** Reveal a path in the OS file manager (Finder / Explorer / xdg-open).
 *  Highlights the entry inside its parent folder where the platform
 *  supports it; otherwise opens the parent. */
export const fsRevealInOs = (path: string): Promise<void> =>
  invoke<void>("fs_reveal_in_os", { path });

/** Open a path with the OS default application. */
export const fsOpenWithDefault = (path: string): Promise<void> =>
  invoke<void>("fs_open_with_default", { path });

/** Open the user's preferred terminal at `path`. Path must be a
 *  directory; the context menu hides this action for files. */
export const fsOpenInTerminal = (path: string): Promise<void> =>
  invoke<void>("fs_open_in_terminal", { path });

/** EXIF metadata for an image file. All fields are optional — `null`
 *  means the image lacks the corresponding tag (or isn't a JPEG/TIFF). */
export interface ImageExif {
  dateTaken: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  iso: string | null;
  exposure: string | null;
  aperture: string | null;
  focalLength: string | null;
}

/** Create an empty file at `path`. Errors if the path already exists.
 *  Used by the toolbar's "New file" button. */
export const fsCreateEmptyFile = (path: string): Promise<void> =>
  invoke<void>("fs_create_empty_file", { path });

/** Synchronously copy `from` to `to` — files copy directly, folders
 *  walk recursively. Errors if `to` already exists. Used by the
 *  Duplicate right-click action so the Browser can refresh once the
 *  copy is on disk (skipping the async-Skiffsync race). */
export const fsCopyRecursive = (from: string, to: string): Promise<void> =>
  invoke<void>("fs_copy_recursive", { from, to });

/** Return the OS Trash / Recycle Bin folder path. macOS: ~/.Trash.
 *  Linux: ~/.local/share/Trash/files. Windows: `null` (Recycle Bin
 *  isn't a real filesystem path). Frontend hides the Trash favorite
 *  on null. */
export const fsTrashPath = (): Promise<string | null> =>
  invoke<string | null>("fs_trash_path");

/** Bundle one or more local paths into a zip archive at `destZip`.
 *  Folders walk recursively. Errors if `destZip` already exists. */
export const fsCompressZip = (
  paths: string[],
  destZip: string,
): Promise<void> =>
  invoke<void>("fs_compress_zip", { paths, destZip });

/** Extract a zip archive into `destDir`. Creates `destDir` if needed.
 *  Path-traversal entries (absolute paths, `..` components) are
 *  silently skipped. */
export const fsExtractZip = (
  zipPath: string,
  destDir: string,
): Promise<void> =>
  invoke<void>("fs_extract_zip", { zipPath, destDir });

/** Mirror of `crate::commands::MountedVolume`. Used by the Sidebar's
 *  Devices section to show the system disk + any plugged-in
 *  externals. */
export interface MountedVolume {
  name: string;
  mountPoint: string;
  total: number;
  free: number;
  removable: boolean;
}

/** List user-facing mounted volumes (system disk + any USB / external
 *  drives). Pseudo-filesystems are filtered server-side. */
export const fsMounts = (): Promise<MountedVolume[]> =>
  invoke<MountedVolume[]>("fs_mounts");

/** Compute the SHA-256 hash of a local file. Streams the file in
 *  chunks so large files don't load into memory; returns hex-encoded. */
export const fsHashSha256 = (path: string): Promise<string> =>
  invoke<string>("fs_hash_sha256", { path });

/** Read EXIF off a local image. Returns an all-`null` struct when the
 *  file isn't EXIF-bearing rather than throwing. */
export const fsImageExif = (path: string): Promise<ImageExif> =>
  invoke<ImageExif>("fs_image_exif", { path });

/** Rotate an on-disk image by ±90 / ±180 / ±270 degrees, in place.
 *  Decodes + rotates pixel buffer + re-encodes back to the original
 *  format. Atomic write (temp + rename) so a crash mid-encode
 *  doesn't truncate the original. JPEG round-trip is lossy at high
 *  quality; PNG / GIF / BMP / lossless WebP are bit-perfect. */
export const fsImageRotate = (path: string, degrees: number): Promise<void> =>
  invoke<void>("fs_image_rotate", { path, degrees });

/** Filesystem totals for the partition that hosts `path`. Bytes. */
export interface DiskSpace {
  total: number;
  free: number;
}

/** Returns the host filesystem's total + free byte counts. */
export const fsDiskSpace = (path: string): Promise<DiskSpace> =>
  invoke<DiskSpace>("fs_disk_space", { path });

export const fsCopyFile = (from: string, to: string): Promise<number> =>
  invoke<number>("fs_copy_file", { from, to });

export const fsCanonicalize = (path: string): Promise<string> =>
  invoke<string>("fs_canonicalize", { path });

// ---------- Preview commands (Phase 1.5) ----------

/** Mirror of `crate::fs::local::DirSummary`. */
export interface DirSummary {
  entries: number;
  totalSize: number;
  /** True when the recursive scan hit the entry cap before finishing. */
  truncated: boolean;
}

/** Read the head of a text file. Capped server-side; never returns more
 *  than ~256 KB. */
export const fsReadText = (path: string): Promise<string> =>
  invoke<string>("fs_read_text", { path });

/** Read the entire file as base64. Errors for files over 16 MB. The caller
 *  wraps this in a data URL for inline image rendering. */
export const fsReadBase64 = (path: string): Promise<string> =>
  invoke<string>("fs_read_base64", { path });

/** Recursive entry count + total size for a folder. Capped scan. */
export const fsDirSummary = (path: string): Promise<DirSummary> =>
  invoke<DirSummary>("fs_dir_summary", { path });

/** Recursive substring find. Returns up to 1000 entries; stops walking
 *  after 10 s. `.git` / `node_modules` / `_recycleBin` are pruned. */
export const windowSetAlwaysOnTop = (enabled: boolean): Promise<void> =>
  invoke<void>("window_set_always_on_top", { enabled });

export const fsFind = (
  path: string,
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean } = {},
): Promise<Entry[]> =>
  invoke<Entry[]>("fs_find", {
    path,
    query,
    regex: opts.regex ?? false,
    caseSensitive: opts.caseSensitive ?? false,
  });
