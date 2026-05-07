// Typed wrappers around the `sync_*` Tauri commands and the
// `sync:progress` / `sync:done` / `sync:error` events. Phase 4a only
// supports local-to-local; cross-protocol jobs land in 4b.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirror of `crate::sync::types::ConflictPolicy`. The smart-batch
 *  variants match the TeraCopy "Destination File Already Exists"
 *  dialog action set verbatim. `prompt` blocks each conflict on a
 *  modal — see [[ConflictPromptDecision]] for the set of replies. */
export type ConflictPolicy =
  | "skip"
  | "overwrite"
  | "keepBoth"
  | "overwriteOlder"
  | "replaceSmaller"
  | "replaceIfSizeDifferent"
  | "renameTarget"
  | "renameOlderTarget"
  | "prompt";

/** Mirror of `crate::sync::types::ConflictPromptDecision`.
 *  The `*All` variants are the TeraCopy "Apply to all remaining"
 *  buttons in the modal; the engine's per-job closure caches them
 *  and skips prompting for subsequent conflicts. */
export type ConflictPromptDecision =
  | "overwrite"
  | "skip"
  | "keepBoth"
  | "overwriteAll"
  | "skipAll"
  | "keepBothAll"
  | "cancelJob";

/** Mirror of `crate::sync::types::ConflictPrompt`. */
export interface ConflictPromptPayload {
  jobId: string;
  conflictId: string;
  src: string;
  dest: string;
  srcSize: number;
  destSize: number;
  srcMtime: number | null;
  destMtime: number | null;
}

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
  | "paused"
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

/** `cprepo` mode — same shape as syncStartLocal but only git-tracked
 *  files are included in the plan. */
export const syncStartRepo = (
  src: string,
  dest: string,
  options?: JobOptions,
): Promise<string> =>
  invoke<string>("sync_start_repo", { src, dest, options });

/** Cross-protocol sync. Either side may be local or `sftp://<id>/...`.
 *  The Rust side dispatches the engine; the frontend just hands over
 *  the strings. */
export const syncStartCross = (
  src: string,
  dest: string,
  options?: JobOptions,
): Promise<string> =>
  invoke<string>("sync_start_cross", { src, dest, options });

/** `cpstamp` mode — copy `src` into `destDir` with a YYYY_MM_DD_HH_MM
 *  suffix. Returns the path the stamped copy landed at. */
export const syncCpstamp = (src: string, destDir: string): Promise<string> =>
  invoke<string>("sync_cpstamp", { src, destDir });

/** Mirror of `crate::sync::dedup::DedupSummary`. */
export interface DedupSummary {
  scanned: number;
  duplicates: number;
  bytesFreed: number;
  recycleBin: string;
}

/** `dedup` mode — recursively scan, move duplicates to _recycleBin/. */
export const syncDedup = (path: string): Promise<DedupSummary> =>
  invoke<DedupSummary>("sync_dedup", { path });

export const syncCancel = (id: string): Promise<void> =>
  invoke<void>("sync_cancel", { id });

/** Pause a running job. Block at the next inter-file checkpoint until
 *  syncResume or syncCancel. */
export const syncPause = (id: string): Promise<void> =>
  invoke<void>("sync_pause", { id });

/** Resume a paused job. No-op when the job isn't paused. */
export const syncResume = (id: string): Promise<void> =>
  invoke<void>("sync_resume", { id });

/** Reply to a sync:conflict prompt. The conflict id comes from the
 *  event payload; the decision is whatever button the user clicked. */
export const syncResolveConflict = (
  jobId: string,
  conflictId: string,
  decision: ConflictPromptDecision,
): Promise<void> =>
  invoke<void>("sync_resolve_conflict", { jobId, conflictId, decision });

/** Subscribe to sync:conflict events. The modal in TransfersPage uses
 *  this to surface the TeraCopy-style prompt. */
export const onConflict = (
  cb: (p: ConflictPromptPayload) => void,
): Promise<UnlistenFn> =>
  listen<ConflictPromptPayload>("sync:conflict", (e) => cb(e.payload));

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
