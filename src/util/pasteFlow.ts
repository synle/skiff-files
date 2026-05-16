// Pure orchestration helper for the Cmd+V paste flow. Extracted
// from `pages/Browser.tsx` so we can unit-test the
// refresh-after-sync-done + clipboard-clear contract without
// rendering the React tree.
//
// Two regressions this guards against:
//   1) Destination wasn't refreshing after a multi-file SMB paste —
//      `sync_start_cross` returns when the job is QUEUED, so an
//      immediate `refresh()` ran before the bytes had landed.
//   2) The "Paste N items" toolbar pill stayed visible after a
//      paste, so users hit Cmd+V again thinking it didn't take and
//      ended up with duplicate copies.
//
// And one workflow improvement:
//   3) Multi-file pastes are SERIALIZED through one sync job at a
//      time. Earlier "fire all N in parallel" produced "60
//      operations in progress" stuck rows in the drawer — every
//      job was queued before the first had a chance to finish, and
//      the remote-side single-flight mutex (SMB) meant nothing
//      really progressed in parallel anyway. Serial dispatch keeps
//      the drawer clean (one row at a time), gives the user clear
//      per-file progress, and matches what every other file manager
//      does for multi-file paste.

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
  /** Per-job watchdog: if `sync:done` never fires (cancelled job /
   *  engine crash), give up waiting after this many ms and proceed
   *  to the next source. Defaults to 30 minutes — long enough for a
   *  multi-GB transfer to finish on a slow connection, short enough
   *  that a stuck job doesn't block the rest forever. */
  perJobTimeoutMs?: number;
}

/** Orchestrate a paste: hide the pill, dispatch syncs one-at-a-time,
 *  refresh after each completes, and on `cut` remove the sources
 *  once every job has fired. Returns once the entire orchestration
 *  has settled. */
export async function runPaste(
  clipboard: PasteClipboard,
  destFolder: string,
  deps: PasteDeps,
): Promise<{ jobIds: Set<string> }> {
  const isCut = clipboard.operation === "cut";
  const remoteCutPaths: string[] = [];
  const jobIds = new Set<string>();
  const perJobTimeoutMs = deps.perJobTimeoutMs ?? 30 * 60_000;

  // Hide the "Paste N items" toolbar pill up-front so repeated
  // paste-into-same-folder doesn't happen by accident.
  deps.clearClipboard();

  // Single shared `sync:done` subscription — we resolve a per-job
  // promise from inside the listener. Subscribing once (instead of
  // once-per-source) keeps the listener overhead constant
  // regardless of how many files the user pasted.
  const resolvers = new Map<string, () => void>();
  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await deps.onDone((summary) => {
      const resolve = resolvers.get(summary.jobId);
      if (!resolve) return;
      resolvers.delete(summary.jobId);
      resolve();
    });
  } catch {
    // Without the listener we'd loop forever on the per-job await;
    // fall back to a non-blocking dispatch with a single refresh at
    // the end so partial behaviour is still acceptable.
    unlisten = null;
  }
  /** Wait for `sync:done` for the given job-id, or the per-job
   *  watchdog. Resolves cleanly in both cases — callers don't need
   *  to distinguish (the engine prunes its own state regardless). */
  const waitForJob = (jobId: string) =>
    new Promise<void>((resolve) => {
      if (!unlisten) {
        // No listener attached — bail immediately so the loop can
        // continue without blocking.
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        resolvers.delete(jobId);
        resolve();
      }, perJobTimeoutMs);
      resolvers.set(jobId, () => {
        clearTimeout(timer);
        resolve();
      });
    });

  for (const src of clipboard.paths) {
    try {
      const meta = await deps.stat(src);
      const dest = meta.isDir ? `${destFolder}/${meta.name}` : destFolder;
      const jobId = await deps.startSync(src, dest);
      jobIds.add(jobId);
      if (isCut) remoteCutPaths.push(src);
      // Wait for this job to finish before kicking the next one.
      // Serial dispatch keeps the OperationsDrawer at one row at a
      // time and avoids the "60 stuck rows" pile-up the parallel
      // shape produced.
      await waitForJob(jobId);
      // Refresh the destination after each file lands so the user
      // sees the listing grow as files arrive. Skipped when the
      // user has navigated away.
      if (deps.currentPath() === destFolder) {
        try { await deps.refresh(destFolder); } catch { /* tolerated */ }
      }
    } catch (e) {
      deps.onError(String(e));
    }
  }

  if (unlisten) {
    try { unlisten(); } catch { /* ignore */ }
  }

  // Cut-mode cleanup: remove the sources once every copy is done.
  if (isCut && remoteCutPaths.length > 0) {
    try {
      await deps.removeOrTrashMany(remoteCutPaths);
    } catch {
      /* engine errors surface in TransfersPage; the saved jobs are
       * already gone from the user's POV anyway. */
    }
    if (deps.currentPath() === destFolder) {
      try { await deps.refresh(destFolder); } catch { /* tolerated */ }
    }
  } else if (deps.currentPath() === destFolder) {
    // Belt-and-braces final refresh for the copy path.
    try { await deps.refresh(destFolder); } catch { /* tolerated */ }
  }

  return { jobIds };
}
