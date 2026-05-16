// Pure orchestration helper for the Cmd+V paste flow. Extracted from
// `pages/Browser.tsx` so we can unit-test the refresh-after-sync-done
// + clipboard-clear contract without rendering the React tree.
//
// Two regressions this guards against:
//   1) Destination wasn't refreshing after a multi-file SMB paste —
//      `sync_start_cross` returns when the job is QUEUED, so an
//      immediate `refresh()` ran before the bytes had landed and the
//      user had to hit the manual Refresh button to see the new
//      files (image #5).
//   2) The "Paste N items" toolbar pill stayed visible after a paste,
//      so users hit Cmd+V again thinking it didn't take and ended up
//      with duplicate copies (image #6).
//
// The orchestrator clears the clipboard up-front, dispatches a sync
// per source, waits for the `sync:done` event on each job-id, and
// refreshes the destination once each one lands.

import type { Summary } from "../api/sync";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** Subset of the file clipboard payload the paste flow consumes. */
export interface PasteClipboard {
  paths: string[];
  operation: "copy" | "cut";
}

/** Minimal stat shape the dispatcher needs to decide whether a source
 *  is a directory (which gets a name-prefixed dest) or a file (which
 *  lands directly in the destination folder). */
export interface PasteStat {
  name: string;
  isDir: boolean;
}

export interface PasteDeps {
  /** Backend-agnostic stat — must work for local + sftp:// + smb://. */
  stat: (path: string) => Promise<PasteStat>;
  /** `client.startSync` — returns a queued job id. */
  startSync: (src: string, dest: string) => Promise<string>;
  /** Re-list the destination folder. */
  refresh: (path: string) => Promise<void> | void;
  /** Subscribe to per-job completion events. Returns an unlisten fn. */
  onDone: (cb: (s: Summary) => void) => Promise<UnlistenFn>;
  /** Hide the "Paste N items" toolbar pill — clears the in-memory clipboard. */
  clearClipboard: () => void;
  /** Best-effort remove the source paths (cut path only). */
  removeOrTrashMany: (paths: string[]) => Promise<unknown>;
  /** Called for per-source errors so the page can surface them. */
  onError: (msg: string) => void;
  /** Test seam — when the user navigates away mid-paste we skip the
   *  destination refresh. Returns the path currently shown by the
   *  caller; the orchestrator compares against the original destFolder. */
  currentPath: () => string;
  /** Watchdog timeout for unfired `sync:done` events (cancelled /
   *  failed jobs). Defaults to 60s; tests override to keep runs fast. */
  doneTimeoutMs?: number;
}

/** Orchestrate a paste: hide the pill, dispatch syncs, refresh after
 *  each job completes, and on `cut` remove the sources once every
 *  job has fired. Resolves once the orchestration kicks off — the
 *  refresh + cut-cleanup happens asynchronously via `onDone`. */
export async function runPaste(
  clipboard: PasteClipboard,
  destFolder: string,
  deps: PasteDeps,
): Promise<{ jobIds: Set<string> }> {
  const isCut = clipboard.operation === "cut";
  const remoteCutPaths: string[] = [];
  const jobIds = new Set<string>();
  // Bug 2 — clear clipboard up-front so the "Paste 2 items" pill
  // disappears the instant the user clicks paste. Repeated paste-
  // into-same-folder was almost always an accident.
  deps.clearClipboard();
  for (const src of clipboard.paths) {
    try {
      const meta = await deps.stat(src);
      const dest = meta.isDir ? `${destFolder}/${meta.name}` : destFolder;
      const jobId = await deps.startSync(src, dest);
      jobIds.add(jobId);
      if (isCut) remoteCutPaths.push(src);
    } catch (e) {
      deps.onError(String(e));
    }
  }
  if (jobIds.size === 0) {
    // Every dispatch failed — still refresh in case partial state landed.
    if (deps.currentPath() === destFolder) await deps.refresh(destFolder);
    return { jobIds };
  }
  // Optimistic post-dispatch refresh. Kernel-accelerated local copies
  // can land bytes synchronously before sync:done makes the event-loop
  // hop; refreshing here means the new entries show up the instant
  // sync_start_local returns, no awkward "waiting on event" gap.
  if (deps.currentPath() === destFolder) {
    try { await deps.refresh(destFolder); } catch { /* surface elsewhere */ }
  }
  // Bug 1 — wait for sync:done for each queued job and refresh as
  // each one lands. We unlisten once every id has fired.
  const pending = new Set(jobIds);
  let unlisten: UnlistenFn | null = null;
  let settled = false;
  const cleanup = () => {
    if (unlisten) {
      try { unlisten(); } catch { /* ignore */ }
      unlisten = null;
    }
  };
  const finalize = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (isCut && remoteCutPaths.length > 0) {
      void deps.removeOrTrashMany(remoteCutPaths)
        .catch(() => { /* engine errors surface elsewhere */ })
        .finally(() => {
          if (deps.currentPath() === destFolder) void deps.refresh(destFolder);
        });
    } else if (deps.currentPath() === destFolder) {
      void deps.refresh(destFolder);
    }
  };
  const un = await deps.onDone((summary) => {
    if (!pending.has(summary.jobId)) return;
    pending.delete(summary.jobId);
    if (deps.currentPath() === destFolder) void deps.refresh(destFolder);
    if (pending.size === 0) finalize();
  });
  unlisten = un;
  // Race: every job may have completed before the listener attached
  // (rare, but possible for kernel-accelerated local copies on a
  // fast disk).
  if (pending.size === 0) finalize();
  // Watchdog so a cancelled / failed job that never emits sync:done
  // doesn't leak the listener forever.
  const timeoutMs = deps.doneTimeoutMs ?? 60_000;
  setTimeout(() => {
    if (!settled) finalize();
  }, timeoutMs);
  return { jobIds };
}
