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

/** Read EXIF off a local image. Returns an all-`null` struct when the
 *  file isn't EXIF-bearing rather than throwing. */
export const fsImageExif = (path: string): Promise<ImageExif> =>
  invoke<ImageExif>("fs_image_exif", { path });

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
export const fsFind = (path: string, query: string): Promise<Entry[]> =>
  invoke<Entry[]>("fs_find", { path, query });
