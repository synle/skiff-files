// Typed wrappers around the `sync_*` Tauri commands and the
// `sync:progress` / `sync:done` / `sync:error` events. Phase 4a only
// supports local-to-local; cross-protocol jobs land in 4b.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirror of `crate::sync::types::ConflictPolicy`. The smart-batch
 *  variants match the TeraCopy "Destination File Already Exists"
 *  dialog action set verbatim. */
export type ConflictPolicy =
  | "skip"
  | "overwrite"
  | "keepBoth"
  | "overwriteOlder"
  | "replaceSmaller"
  | "replaceIfSizeDifferent"
  | "renameTarget"
  | "renameOlderTarget";

/** Mirror of `crate::sync::types::JobOptions`. */
export interface JobOptions {
  maxSizeGb?: number;
  lookbackDays?: number;
  conflictPolicy?: ConflictPolicy;
  dryRun?: boolean;
}

/** Mirror of `crate::sync::types::JobState`. */
export type JobState =
  | "planning"
  | "running"
  | "cancelled"
  | "done"
  | "failed";

/** Mirror of `crate::sync::types::JobInfo`. */
export interface JobInfo {
  id: string;
  src: string;
  dest: string;
  state: JobState;
}

/** Mirror of `crate::sync::types::FileOutcome`. The discriminant is on
 *  `kind` — matches the serde tag in the Rust enum. */
export type FileOutcome =
  | { kind: "copied"; src: string; dest: string; bytes: number }
  | { kind: "skipped"; src: string; dest: string; reason: string }
  | { kind: "conflict"; src: string; dest: string; reason: string }
  | { kind: "error"; src: string; dest: string; error: string };

/** Mirror of `crate::sync::types::Progress`. */
export interface Progress {
  jobId: string;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  last: FileOutcome | null;
}

/** Mirror of `crate::sync::types::Summary`. */
export interface Summary {
  jobId: string;
  copied: number;
  skipped: number;
  conflicts: number;
  errors: number;
  bytesCopied: number;
  cancelled: boolean;
}

export const syncStartLocal = (
  src: string,
  dest: string,
  options?: JobOptions,
): Promise<string> =>
  invoke<string>("sync_start_local", { src, dest, options });

export const syncCancel = (id: string): Promise<void> =>
  invoke<void>("sync_cancel", { id });

export const syncList = (): Promise<JobInfo[]> =>
  invoke<JobInfo[]>("sync_list");

/** Subscribe to per-file progress. The returned unlisten fn must be
 *  called on unmount to avoid leaking listeners. */
export const onProgress = (cb: (p: Progress) => void): Promise<UnlistenFn> =>
  listen<Progress>("sync:progress", (e) => cb(e.payload));

/** Subscribe to job completion. */
export const onDone = (cb: (s: Summary) => void): Promise<UnlistenFn> =>
  listen<Summary>("sync:done", (e) => cb(e.payload));

/** Subscribe to job-level fatal errors (NOT per-file errors — those are
 *  rolled into the summary). */
export const onError = (
  cb: (e: { jobId: string; error: string }) => void,
): Promise<UnlistenFn> =>
  listen<{ jobId: string; error: string }>("sync:error", (e) => cb(e.payload));
