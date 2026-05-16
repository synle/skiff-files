// Regression tests for the Cmd+V paste orchestrator.
//
// Pins:
//   - Clipboard pill clears the instant paste starts (no duplicate-
//     paste accidents).
//   - Destination refreshes after each sync:done so the file list
//     grows as files arrive.
//   - Multi-file paste runs SERIALLY through one sync at a time
//     (parallel dispatch produced "N stuck rows" in the drawer).
//   - Cut-mode removes sources only after every copy lands.
//   - Per-source errors don't abort the rest of the batch.
//
// The test uses fake timers + a manual "fire sync:done" trigger so
// the serial sequence is deterministic — without that, each await
// inside `runPaste` would wait forever for an event that never came.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPaste, type PasteDeps } from "./pasteFlow";
import type { Summary } from "../api/sync";

function makeSummary(jobId: string): Summary {
  return {
    jobId,
    copied: 1,
    skipped: 0,
    conflicts: 0,
    errors: 0,
    bytesCopied: 1,
    cancelled: false,
  };
}

/** Build a `PasteDeps` test double with a manual `fireDone` trigger.
 *  Because `runPaste` now blocks on `sync:done` per job, every test
 *  has to drive the listener manually after each `startSync`. */
function makeDeps(over: Partial<PasteDeps> = {}) {
  let doneListener: ((s: Summary) => void) | null = null;
  const refresh = vi.fn();
  const clearClipboard = vi.fn();
  const removeOrTrashMany = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const stat = vi.fn(async (p: string) => ({
    name: p.split("/").pop() ?? p,
    isDir: false,
  }));
  let jobIdCounter = 0;
  const startedJobIds: string[] = [];
  const startSync = vi.fn(async () => {
    const id = `job-${++jobIdCounter}`;
    startedJobIds.push(id);
    return id;
  });
  const onDone = vi.fn(async (cb: (s: Summary) => void) => {
    doneListener = cb;
    return () => { doneListener = null; };
  });
  const deps: PasteDeps = {
    stat,
    startSync,
    refresh,
    onDone,
    clearClipboard,
    removeOrTrashMany,
    onError,
    currentPath: () => "/dest",
    perJobTimeoutMs: 5_000,
    ...over,
  };
  return {
    deps,
    refresh,
    clearClipboard,
    removeOrTrashMany,
    onError,
    startSync,
    stat,
    onDone,
    startedJobIds,
    fireDone: (id: string) => doneListener?.(makeSummary(id)),
  };
}

/** Run a paste while interleaving "fire sync:done" calls between
 *  each `startSync`. Mimics what happens at runtime: the engine
 *  completes one job, the orchestrator unblocks, kicks the next.
 *  We can't `await runPaste(...)` directly because it would block
 *  forever waiting for done events; instead we kick a microtask
 *  loop that drains pending starts + fires done events for them. */
async function pumpPaste(
  promise: Promise<{ jobIds: Set<string> }>,
  startedJobIds: string[],
  fireDone: (id: string) => void,
): Promise<{ jobIds: Set<string> }> {
  let done = false;
  promise.finally(() => { done = true; });
  // Round-trip the microtask queue until the paste resolves or we
  // exhaust a generous iteration budget. Each pass drains pending
  // `startSync` resolutions; we fire `done` for each newly-started
  // job so the per-job await unblocks.
  let fired = 0;
  for (let i = 0; i < 100 && !done; i++) {
    // Yield the microtask queue twice so `await stat` + `await
    // startSync` both settle before we look at startedJobIds.
    await new Promise((r) => setTimeout(r, 0));
    while (fired < startedJobIds.length) {
      fireDone(startedJobIds[fired++]);
    }
  }
  return promise;
}

beforeEach(() => {
  // Real timers — pumpPaste uses real setTimeout to flush microtasks.
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runPaste", () => {
  it("clears the file clipboard up-front", async () => {
    const { deps, clearClipboard, startedJobIds, fireDone } = makeDeps();
    await pumpPaste(
      runPaste({ paths: ["/src/a.png"], operation: "copy" }, "/dest", deps),
      startedJobIds,
      fireDone,
    );
    expect(clearClipboard).toHaveBeenCalledTimes(1);
  });

  it("dispatches sync jobs SERIALLY — one source at a time", async () => {
    // Earlier shape fired all N startSyncs in parallel and produced
    // "60 stuck rows" in the drawer. Serial dispatch is the fix.
    const { deps, startSync, startedJobIds, fireDone } = makeDeps();
    await pumpPaste(
      runPaste(
        { paths: ["/src/a", "/src/b", "/src/c"], operation: "copy" },
        "/dest",
        deps,
      ),
      startedJobIds,
      fireDone,
    );
    expect(startSync).toHaveBeenCalledTimes(3);
    // Order matters: a, then b, then c.
    expect(startSync).toHaveBeenNthCalledWith(1, "/src/a", "/dest");
    expect(startSync).toHaveBeenNthCalledWith(2, "/src/b", "/dest");
    expect(startSync).toHaveBeenNthCalledWith(3, "/src/c", "/dest");
  });

  it("refreshes the destination after each sync:done fires", async () => {
    const { deps, refresh, startedJobIds, fireDone } = makeDeps();
    const { jobIds } = await pumpPaste(
      runPaste(
        { paths: ["/src/a.png", "/src/b.png"], operation: "copy" },
        "/dest",
        deps,
      ),
      startedJobIds,
      fireDone,
    );
    expect(jobIds.size).toBe(2);
    // One refresh per job (after its done event) plus the final
    // belt-and-braces refresh = at least 2 calls.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(refresh).toHaveBeenLastCalledWith("/dest");
  });

  it("dirs get their basename appended to the dest; files land directly", async () => {
    const customStat = vi.fn(async (p: string) => ({
      name: p.split("/").pop() ?? p,
      isDir: p.endsWith("/folder"),
    }));
    const { deps, startSync, startedJobIds, fireDone } = makeDeps({
      stat: customStat,
    });
    await pumpPaste(
      runPaste(
        { paths: ["/src/file.txt", "/src/folder"], operation: "copy" },
        "/dest",
        deps,
      ),
      startedJobIds,
      fireDone,
    );
    expect(customStat).toHaveBeenCalledTimes(2);
    expect(startSync).toHaveBeenCalledWith("/src/file.txt", "/dest");
    expect(startSync).toHaveBeenCalledWith("/src/folder", "/dest/folder");
  });

  it("cut-mode removes sources after every copy lands", async () => {
    const { deps, removeOrTrashMany, startedJobIds, fireDone } = makeDeps();
    await pumpPaste(
      runPaste(
        { paths: ["/src/a", "/src/b"], operation: "cut" },
        "/dest",
        deps,
      ),
      startedJobIds,
      fireDone,
    );
    expect(removeOrTrashMany).toHaveBeenCalledTimes(1);
    expect(removeOrTrashMany).toHaveBeenCalledWith(["/src/a", "/src/b"]);
  });

  it("skips refresh when the user has navigated away mid-paste", async () => {
    const refresh = vi.fn();
    const { deps, startedJobIds, fireDone } = makeDeps({
      refresh,
      currentPath: () => "/somewhere/else",
    });
    await pumpPaste(
      runPaste({ paths: ["/src/a"], operation: "copy" }, "/dest", deps),
      startedJobIds,
      fireDone,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces per-source stat errors via onError, continues other sources", async () => {
    const { deps, onError, startSync, startedJobIds, fireDone } = makeDeps({
      stat: vi.fn(async (p: string) => {
        if (p === "/src/bad") throw new Error("stat failed");
        return { name: p.split("/").pop() ?? p, isDir: false };
      }),
    });
    await pumpPaste(
      runPaste(
        { paths: ["/src/bad", "/src/good"], operation: "copy" },
        "/dest",
        deps,
      ),
      startedJobIds,
      fireDone,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(startSync).toHaveBeenCalledWith("/src/good", "/dest");
  });

  it("per-job watchdog unblocks the loop when sync:done never fires", async () => {
    // Defensive — if the engine crashes mid-job and never emits
    // sync:done, the orchestrator must NOT block the rest of the
    // paste forever. The per-job timeout drains the await.
    const { deps, startSync, startedJobIds } = makeDeps({
      perJobTimeoutMs: 30,
    });
    // Don't fire any done events — let the watchdog do the work.
    await runPaste(
      { paths: ["/src/a", "/src/b"], operation: "copy" },
      "/dest",
      deps,
    );
    // Both syncs still kicked, just spaced out by the watchdog.
    expect(startSync).toHaveBeenCalledTimes(2);
    expect(startedJobIds).toHaveLength(2);
  });
});
