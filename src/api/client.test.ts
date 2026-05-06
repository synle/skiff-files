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
