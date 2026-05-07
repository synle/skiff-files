import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  dirSummary,
  listDir,
  readBase64,
  readText,
  stat,
} from "./client";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
});

describe("client.listDir", () => {
  it("routes local paths through fs_list_dir", async () => {
    mocked.mockResolvedValueOnce([]);
    await listDir("/Users/syle");
    expect(mocked).toHaveBeenCalledWith("fs_list_dir", {
      path: "/Users/syle",
      options: undefined,
    });
  });

  it("routes sftp paths through conn_list_dir + reshapes Entry.path", async () => {
    mocked.mockResolvedValueOnce([
      {
        name: "foo",
        path: "/home/foo",
        kind: "folder",
        size: 0,
        mtime: null,
        isDir: true,
        isSymlink: false,
        isHidden: false,
        mode: null,
      },
    ]);
    const out = await listDir("sftp://abc/home");
    expect(mocked).toHaveBeenCalledWith("conn_list_dir", {
      id: "abc",
      path: "/home",
      options: undefined,
    });
    expect(out[0].path).toBe("sftp://abc/home/foo");
  });
});

describe("client.stat / readText / readBase64 / dirSummary route by scheme", () => {
  it("local stat", async () => {
    mocked.mockResolvedValueOnce({});
    await stat("/x");
    expect(mocked).toHaveBeenLastCalledWith("fs_stat", { path: "/x" });
  });
  it("sftp stat", async () => {
    mocked.mockResolvedValueOnce({
      name: "x",
      path: "/x",
      kind: "folder",
      size: 0,
      mtime: null,
      isDir: true,
      isSymlink: false,
      isHidden: false,
      mode: null,
    });
    await stat("sftp://abc/x");
    expect(mocked).toHaveBeenLastCalledWith("conn_stat", {
      id: "abc",
      path: "/x",
    });
  });

  it("readText routes both", async () => {
    mocked.mockResolvedValueOnce("local");
    await readText("/a");
    expect(mocked).toHaveBeenLastCalledWith("fs_read_text", { path: "/a" });
    mocked.mockResolvedValueOnce("remote");
    await readText("sftp://abc/a");
    expect(mocked).toHaveBeenLastCalledWith("conn_read_text", {
      id: "abc",
      path: "/a",
    });
  });

  it("readBase64 routes both", async () => {
    mocked.mockResolvedValueOnce("AAA=");
    await readBase64("/a");
    expect(mocked).toHaveBeenLastCalledWith("fs_read_base64", { path: "/a" });
    mocked.mockResolvedValueOnce("AAA=");
    await readBase64("sftp://abc/a");
    expect(mocked).toHaveBeenLastCalledWith("conn_read_base64", {
      id: "abc",
      path: "/a",
    });
  });

  it("dirSummary routes both", async () => {
    mocked.mockResolvedValueOnce({
      entries: 1,
      totalSize: 0,
      truncated: false,
    });
    await dirSummary("/a");
    expect(mocked).toHaveBeenLastCalledWith("fs_dir_summary", { path: "/a" });
    mocked.mockResolvedValueOnce({
      entries: 1,
      totalSize: 0,
      truncated: false,
    });
    await dirSummary("sftp://abc/a");
    expect(mocked).toHaveBeenLastCalledWith("conn_dir_summary", {
      id: "abc",
      path: "/a",
    });
  });
});

describe("client.mkdir / removeOrTrashMany dispatch", () => {
  it("mkdir routes local through fs_mkdir", async () => {
    mocked.mockResolvedValueOnce(undefined);
    const { mkdir } = await import("./client");
    await mkdir("/x/new");
    expect(mocked).toHaveBeenLastCalledWith("fs_mkdir", { path: "/x/new" });
  });

  it("mkdir routes sftp through conn_mkdir", async () => {
    mocked.mockResolvedValueOnce(undefined);
    const { mkdir } = await import("./client");
    await mkdir("sftp://abc/new");
    expect(mocked).toHaveBeenLastCalledWith("conn_mkdir", {
      id: "abc",
      path: "/new",
    });
  });

  it("removeOrTrashMany batches locals + dispatches remotes per-path", async () => {
    mocked.mockResolvedValueOnce(undefined); // fs_trash_many for the locals
    mocked.mockResolvedValueOnce(undefined); // conn_remove for /a
    mocked.mockResolvedValueOnce(undefined); // conn_remove for /b
    const { removeOrTrashMany } = await import("./client");
    await removeOrTrashMany([
      "/local/x",
      "/local/y",
      "sftp://abc/a",
      "sftp://abc/b",
    ]);
    expect(mocked).toHaveBeenCalledWith("fs_trash_many", {
      paths: ["/local/x", "/local/y"],
    });
    expect(mocked).toHaveBeenCalledWith("conn_remove", {
      id: "abc",
      path: "/a",
    });
    expect(mocked).toHaveBeenCalledWith("conn_remove", {
      id: "abc",
      path: "/b",
    });
  });

  it("removeOrTrashMany skips fs_trash_many when no locals", async () => {
    mocked.mockResolvedValueOnce(undefined);
    const { removeOrTrashMany } = await import("./client");
    await removeOrTrashMany(["sftp://abc/only-remote"]);
    // The call ordering is: only conn_remove, no fs_trash_many.
    const calls = mocked.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("fs_trash_many");
    expect(calls).toContain("conn_remove");
  });

  it("startSync routes pure local through sync_start_local", async () => {
    mocked.mockResolvedValueOnce("job-1");
    const { startSync } = await import("./client");
    await startSync("/src", "/dest");
    expect(mocked).toHaveBeenLastCalledWith(
      "sync_start_local",
      expect.objectContaining({ src: "/src", dest: "/dest" }),
    );
  });

  it("startSync routes remote-src through sync_start_cross", async () => {
    mocked.mockResolvedValueOnce("job-2");
    const { startSync } = await import("./client");
    await startSync("sftp://abc/x", "/dest");
    expect(mocked).toHaveBeenLastCalledWith(
      "sync_start_cross",
      expect.objectContaining({ src: "sftp://abc/x", dest: "/dest" }),
    );
  });

  it("startSync routes remote-dest through sync_start_cross", async () => {
    mocked.mockResolvedValueOnce("job-3");
    const { startSync } = await import("./client");
    await startSync("/src", "sftp://abc/x");
    expect(mocked).toHaveBeenLastCalledWith(
      "sync_start_cross",
      expect.objectContaining({ src: "/src", dest: "sftp://abc/x" }),
    );
  });

  it("rename routes local through fs_rename", async () => {
    mocked.mockResolvedValueOnce(undefined);
    const { rename } = await import("./client");
    await rename("/x/old.txt", "/x/new.txt");
    expect(mocked).toHaveBeenLastCalledWith("fs_rename", {
      from: "/x/old.txt",
      to: "/x/new.txt",
    });
  });

  it("rename routes sftp through conn_rename with strippped paths", async () => {
    mocked.mockResolvedValueOnce(undefined);
    const { rename } = await import("./client");
    await rename("sftp://abc/x/old.txt", "sftp://abc/x/new.txt");
    expect(mocked).toHaveBeenLastCalledWith("conn_rename", {
      id: "abc",
      from: "/x/old.txt",
      to: "/x/new.txt",
    });
  });

  it("rename rejects cross-backend rename", async () => {
    const { rename } = await import("./client");
    await expect(rename("/local", "sftp://abc/remote")).rejects.toThrow(
      /across backends/,
    );
  });

  it("rename rejects rename across different sftp connections", async () => {
    const { rename } = await import("./client");
    await expect(
      rename("sftp://abc/x", "sftp://def/x"),
    ).rejects.toThrow(/different sftp connections/);
  });
});
