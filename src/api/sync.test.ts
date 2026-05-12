import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  onConflict,
  onDone,
  onError,
  onProgress,
  syncCancel,
  syncCpstamp,
  syncDedup,
  syncList,
  syncPause,
  syncResolveConflict,
  syncResume,
  syncStartCross,
  syncStartLocal,
  syncStartRepo,
} from "./sync";

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

beforeEach(() => {
  mockedInvoke.mockClear();
  mockedListen.mockClear();
});

describe("api/sync typed wrappers", () => {
  it("invokes the documented sync_* commands", async () => {
    await syncStartLocal("/a", "/b");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_start_local", {
      src: "/a",
      dest: "/b",
      options: undefined,
    });

    await syncStartLocal("/a", "/b", { dryRun: true });
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_start_local", {
      src: "/a",
      dest: "/b",
      options: { dryRun: true },
    });

    await syncStartRepo("/a", "/b");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_start_repo", {
      src: "/a",
      dest: "/b",
      options: undefined,
    });

    await syncStartCross("sftp://id/a", "/b");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_start_cross", {
      src: "sftp://id/a",
      dest: "/b",
      options: undefined,
    });

    await syncCpstamp("/src", "/dir");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_cpstamp", {
      src: "/src",
      destDir: "/dir",
    });

    await syncDedup("/p");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_dedup", { path: "/p" });

    await syncCancel("job");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_cancel", { id: "job" });

    await syncPause("job");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_pause", { id: "job" });

    await syncResume("job");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_resume", { id: "job" });

    await syncResolveConflict("job", "c1", "overwrite");
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_resolve_conflict", {
      jobId: "job",
      conflictId: "c1",
      decision: "overwrite",
    });

    await syncList();
    expect(mockedInvoke).toHaveBeenLastCalledWith("sync_list");
  });

  it("subscribes to the documented sync:* event channels", async () => {
    await onProgress(vi.fn());
    expect(mockedListen).toHaveBeenCalledWith("sync:progress", expect.any(Function));

    await onDone(vi.fn());
    expect(mockedListen).toHaveBeenCalledWith("sync:done", expect.any(Function));

    await onError(vi.fn());
    expect(mockedListen).toHaveBeenCalledWith("sync:error", expect.any(Function));

    await onConflict(vi.fn());
    expect(mockedListen).toHaveBeenCalledWith("sync:conflict", expect.any(Function));
  });

  it("forwards the event payload to the user callback (not the wrapping Event)", async () => {
    const cb = vi.fn();
    // Capture the listener Tauri's listen() registered, then fire it.
    let registered: (e: { payload: unknown }) => void = () => {};
    mockedListen.mockImplementationOnce(async (_name, handler) => {
      registered = handler as (e: { payload: unknown }) => void;
      return () => {};
    });
    await onProgress(cb);
    registered({ payload: { jobId: "j", filesTotal: 1, filesDone: 0, bytesTotal: 1, bytesDone: 0, last: null } });
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j", filesTotal: 1 }),
    );
  });
});
