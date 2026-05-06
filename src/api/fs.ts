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

export const fsCopyFile = (from: string, to: string): Promise<number> =>
  invoke<number>("fs_copy_file", { from, to });

export const fsCanonicalize = (path: string): Promise<string> =>
  invoke<string>("fs_canonicalize", { path });
