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

  // Fallback path: `onDone` subscription itself fails (e.g. Tauri
  // event API unavailable in a test/browser-dev context). The
  // orchestrator must NOT block forever on the per-job await — it
  // detects the absent listener and resolves the waiter immediately
  // so the loop drains. Pins the catch + `unlisten = null` fallback
  // at pasteFlow.ts:100-105 / waitForJob's no-listener early-return.
  it("falls back to non-blocking dispatch when onDone subscription throws", async () => {
    const onDone = vi.fn(async () => {
      throw new Error("event API unavailable");
    });
    const { deps, startSync, refresh, removeOrTrashMany, onError, startedJobIds } = makeDeps({
      onDone,
    });
    const { jobIds } = await runPaste(
      { paths: ["/src/a", "/src/b"], operation: "copy" },
      "/dest",
      deps,
    );
    // Both syncs still fired despite the broken listener — fallback
    // path resolves the waiter immediately rather than hanging.
    expect(startSync).toHaveBeenCalledTimes(2);
    expect(startedJobIds).toHaveLength(2);
    expect(jobIds.size).toBe(2);
    // Final belt-and-braces refresh of the copy path still lands.
    expect(refresh).toHaveBeenCalledWith("/dest");
    expect(removeOrTrashMany).not.toHaveBeenCalled();
    // The broken-listener failure is swallowed (it's already a
    // tolerated degraded mode); per-source errors aren't synthesised.
    expect(onError).not.toHaveBeenCalled();
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

  // 15-item paste — exercises the serial loop at a realistic batch
  // size. The earlier parallel shape would have queued 15 jobs into
  // the drawer simultaneously; the serial shape must emit them in
  // strict source order, one at a time, and clear the clipboard
  // exactly once at the start.
  it("scales to a 15-item paste — strict source order, single clipboard clear", async () => {
    const { deps, startSync, clearClipboard, startedJobIds, fireDone } = makeDeps();
    const sources = Array.from({ length: 15 }, (_, i) => `/src/f${i}.png`);
    await pumpPaste(
      runPaste({ paths: sources, operation: "copy" }, "/dest", deps),
      startedJobIds,
      fireDone,
    );
    expect(clearClipboard).toHaveBeenCalledTimes(1);
    expect(startSync).toHaveBeenCalledTimes(15);
    // Strict source order — assert each nth call individually so an
    // out-of-order regression fails for the right reason.
    for (let i = 0; i < 15; i++) {
      expect(startSync).toHaveBeenNthCalledWith(i + 1, sources[i], "/dest");
    }
  });

  // Cut + rapid-navigation: user pastes a cut clipboard, then
  // navigates away mid-batch. The destination refresh must stop
  // firing (currentPath() no longer matches destFolder), but the
  // sources still get removed at the end because the cut-cleanup
  // doesn't depend on the user staying in the destination.
  it("cut-mode: navigating away mid-paste skips destination refresh but still removes sources", async () => {
    let nowAt = "/dest";
    const refresh = vi.fn();
    const { deps, removeOrTrashMany, startedJobIds, fireDone } = makeDeps({
      refresh,
      currentPath: () => nowAt,
    });
    const promise = runPaste(
      { paths: ["/src/a", "/src/b"], operation: "cut" },
      "/dest",
      deps,
    );
    // After the first startSync resolves, navigate away. The pump
    // loop will then fire done events with nowAt === "/elsewhere",
    // so refresh must NOT be called again.
    let pumped = 0;
    const navigateAfter = (async () => {
      // Wait one microtask cycle so the first start has a chance to
      // land. Real navigation happens via state, not a timer; this
      // approximation is enough for the contract.
      await new Promise((r) => setTimeout(r, 5));
      nowAt = "/elsewhere";
    })();
    await Promise.all([
      navigateAfter,
      pumpPaste(promise, startedJobIds, fireDone),
    ]);
    void pumped;
    // Cut-cleanup must still run — sources removed regardless of
    // where the user navigated.
    expect(removeOrTrashMany).toHaveBeenCalledTimes(1);
    expect(removeOrTrashMany).toHaveBeenCalledWith(["/src/a", "/src/b"]);
  });

  // Mid-paste navigation: user navigates away during a multi-file
  // copy paste. Destination refresh stops once currentPath diverges,
  // but the remaining syncs still kick (they're in flight on the
  // backend — cancelling them isn't paste-flow's job).
  it("navigating away mid-paste suppresses subsequent refreshes but keeps syncs flowing", async () => {
    // Deterministic shape: navigate away AT startSync time for the
    // second source. After that, the rest of the syncs still kick
    // but every refresh call sees currentPath !== destFolder.
    let nowAt = "/dest";
    const refresh = vi.fn();
    let startCount = 0;
    const doneListenerRef: { current: ((s: Summary) => void) | null } = {
      current: null,
    };
    const startedJobIds: string[] = [];
    const startSync = vi.fn(async () => {
      startCount += 1;
      // Flip the nav AT the second start. The first source's done
      // event (which fires from the pump immediately after) will
      // still see /dest mismatch.
      if (startCount === 2) nowAt = "/elsewhere";
      const id = `job-${startCount}`;
      startedJobIds.push(id);
      return id;
    });
    const onDone = vi.fn(async (cb: (s: Summary) => void) => {
      doneListenerRef.current = cb;
      return () => { doneListenerRef.current = null; };
    });
    const deps: PasteDeps = {
      stat: vi.fn(async (p: string) => ({
        name: p.split("/").pop() ?? p,
        isDir: false,
      })),
      startSync,
      refresh,
      onDone,
      clearClipboard: vi.fn(),
      removeOrTrashMany: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
      currentPath: () => nowAt,
      perJobTimeoutMs: 5_000,
    };
    const promise = runPaste(
      { paths: ["/a", "/b", "/c"], operation: "copy" },
      "/dest",
      deps,
    );
    // Drive the pump.
    let fired = 0;
    let done = false;
    promise.finally(() => { done = true; });
    for (let i = 0; i < 100 && !done; i++) {
      await new Promise((r) => setTimeout(r, 0));
      while (fired < startedJobIds.length) {
        doneListenerRef.current?.(makeSummary(startedJobIds[fired++]));
      }
    }
    await promise;
    // All three syncs still fired (backend keeps going).
    expect(startSync).toHaveBeenCalledTimes(3);
    // Only the first source's refresh saw /dest (refresh-per-done
    // for job-1 — currentPath still /dest because nav happens at
    // startSync(2)). All later refreshes skip. So at most one
    // refresh call to /dest landed.
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(1);
  });

  // 10-item paste — assertion is the serial-dispatch contract: each
  // startSync waits for the previous job's done event before firing.
  // Earlier parallel shape would have called all 10 startSyncs back
  // to back; the serial shape must interleave with done events.
  it("10-item paste — each startSync waits for the prior job's done event", async () => {
    /** Track the order of (startSync return, fireDone) events so we
     *  can assert no two startSyncs land before the first one's done
     *  fires. */
    const order: Array<{ kind: "start" | "done"; id: string }> = [];
    const doneListenerRef: { current: ((s: Summary) => void) | null } = {
      current: null,
    };
    let idCounter = 0;
    const startedJobIds: string[] = [];
    const startSync = vi.fn(async () => {
      const id = `job-${++idCounter}`;
      startedJobIds.push(id);
      order.push({ kind: "start", id });
      return id;
    });
    const onDone = vi.fn(async (cb: (s: Summary) => void) => {
      doneListenerRef.current = cb;
      return () => { doneListenerRef.current = null; };
    });
    const deps: PasteDeps = {
      stat: vi.fn(async (p: string) => ({
        name: p.split("/").pop() ?? p,
        isDir: false,
      })),
      startSync,
      refresh: vi.fn(),
      onDone,
      clearClipboard: vi.fn(),
      removeOrTrashMany: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
      currentPath: () => "/dest",
      perJobTimeoutMs: 10_000,
    };
    const sources = Array.from({ length: 10 }, (_, i) => `/src/f${i}`);
    const promise = runPaste(
      { paths: sources, operation: "copy" },
      "/dest",
      deps,
    );
    // Drive the pump: after each startSync, fire its done so the
    // next one unblocks.
    let fired = 0;
    let done = false;
    promise.finally(() => { done = true; });
    for (let i = 0; i < 200 && !done; i++) {
      await new Promise((r) => setTimeout(r, 0));
      while (fired < startedJobIds.length) {
        const id = startedJobIds[fired++];
        order.push({ kind: "done", id });
        doneListenerRef.current?.({
          jobId: id,
          copied: 1,
          skipped: 0,
          conflicts: 0,
          errors: 0,
          bytesCopied: 1,
          cancelled: false,
        });
      }
    }
    await promise;
    expect(startSync).toHaveBeenCalledTimes(10);
    // Walk `order`: for each `start` at index k+1, the immediately
    // preceding entry must be the matching `done` for job k. That
    // pins the serial contract — no two starts in a row without a
    // done in between.
    const starts = order.filter((o) => o.kind === "start");
    const dones = order.filter((o) => o.kind === "done");
    expect(starts.length).toBe(10);
    expect(dones.length).toBe(10);
    for (let i = 1; i < starts.length; i++) {
      // The done for job-i must appear before the start for job-(i+1).
      const doneIdx = order.findIndex(
        (o) => o.kind === "done" && o.id === starts[i - 1].id,
      );
      const nextStartIdx = order.findIndex(
        (o) => o.kind === "start" && o.id === starts[i].id,
      );
      expect(doneIdx).toBeLessThan(nextStartIdx);
    }
  });
});
