// Routing-consolidation regression suite.
//
// The class of bug this guards against is the entire 0.2.270 cluster:
// a verb wrapper hand-rolls its kind dispatch and forgets one arm
// (e.g. mkdir only routes sftp, so the SMB "New Folder" silently
// no-ops; removeOrTrashMany only routes sftp, so the SMB trash hits
// `fs_trash_many` and surfaces `CanonicalizePath { original: "smb://..." }`).
//
// The 0.2.271 routing consolidation centralized every URL → backend
// decision in one `dispatchByLocation` helper. We still pin every
// verb explicitly here so a future refactor that breaks one route
// can't slip through CI.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createEmptyFile,
  dirSummary,
  dispatchByLocation,
  hashSha256,
  listDir,
  mkdir,
  permanentlyDeleteMany,
  readBase64,
  readText,
  removeOrTrashMany,
  rename,
  stat,
  startSync,
} from "./client";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
  mocked.mockReset();
});

/** Minimal Entry stub — we only care that `path` flows through, not
 *  the rest of the metadata. */
function makeEntry(path: string) {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind: "binary",
    size: 0,
    mtime: 0,
    isDir: false,
    isSymlink: false,
    isHidden: false,
    mode: 0,
  };
}

describe("dispatchByLocation — the single URL → handler dispatch", () => {
  it("routes a local path to the `local` handler", async () => {
    const local = vi.fn(async () => "local-result");
    const remote = vi.fn(async () => "remote-result");
    const result = await dispatchByLocation("/Users/test/file.txt", {
      local,
      remote,
    });
    expect(result).toBe("local-result");
    expect(local).toHaveBeenCalledWith("/Users/test/file.txt");
    expect(remote).not.toHaveBeenCalled();
  });

  it("routes sftp:// to `remote` with parsed (id, remotePath, kind)", async () => {
    const remote = vi.fn(async () => "remote-sftp");
    const result = await dispatchByLocation("sftp://abc-123/srv/data", {
      local: vi.fn(),
      remote,
    });
    expect(result).toBe("remote-sftp");
    expect(remote).toHaveBeenCalledWith("abc-123", "/srv/data", "sftp");
  });

  it("routes ftp:// to `remote` with parsed (id, remotePath, kind)", async () => {
    const remote = vi.fn(async () => "remote-ftp");
    await dispatchByLocation("ftp://my-conn/pub/readme", {
      local: vi.fn(),
      remote,
    });
    expect(remote).toHaveBeenCalledWith("my-conn", "/pub/readme", "ftp");
  });

  it("routes smb:// to `remote` with parsed (id, remotePath, kind)", async () => {
    const remote = vi.fn(async () => "remote-smb");
    await dispatchByLocation("smb://uuid-1/share/dir/x", {
      local: vi.fn(),
      remote,
    });
    expect(remote).toHaveBeenCalledWith("uuid-1", "/share/dir/x", "smb");
  });

  it("throws a generic 'not supported on <kind>' error when `remote` is absent", async () => {
    await expect(
      dispatchByLocation("smb://x/y", { local: vi.fn() }),
    ).rejects.toThrow(/not supported on smb/i);
  });

  it("uses the custom `unsupportedRemote` builder when provided", async () => {
    await expect(
      dispatchByLocation("ftp://x/y", {
        local: vi.fn(),
        unsupportedRemote: (kind) =>
          new Error(`custom: hash not available for ${kind}`),
      }),
    ).rejects.toThrow(/custom: hash not available for ftp/);
  });

  it("does NOT call `local` when a remote URL falls through to the unsupported branch", async () => {
    const local = vi.fn();
    await expect(
      dispatchByLocation("smb://x/y", { local }),
    ).rejects.toThrow();
    expect(local).not.toHaveBeenCalled();
  });
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

// =============================================================
// Per-kind fan-out — every verb is pinned for sftp / ftp / smb.
// These tests are explicit defenses against the 0.2.270 class of bug
// (one verb routes some remotes but not others).
// =============================================================

describe("client.stat — every remote scheme routes through conn_stat", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// returns conn_stat with reshaped path",
    async (kind) => {
      mocked.mockImplementation(async (cmd) => {
        if (cmd === "conn_stat") return makeEntry("/server/file");
        return null;
      });
      const e = await stat(`${kind}://id-1/server/file`);
      expect(invoke).toHaveBeenCalledWith(
        "conn_stat",
        expect.objectContaining({ id: "id-1", path: "/server/file" }),
      );
      expect(e.path).toBe(`${kind}://id-1/server/file`);
    },
  );
});

describe("client.listDir — every remote scheme reshapes entries", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// reshapes each entry into the correct scheme",
    async (kind) => {
      mocked.mockImplementation(async (cmd) => {
        if (cmd === "conn_list_dir")
          return [makeEntry("/srv/a"), makeEntry("/srv/b")];
        return null;
      });
      const list = await listDir(`${kind}://id/srv`);
      expect(list.map((e) => e.path)).toEqual([
        `${kind}://id/srv/a`,
        `${kind}://id/srv/b`,
      ]);
    },
  );
});

describe("client.mkdir — every remote scheme hits conn_mkdir", () => {
  it.each(["sftp", "ftp", "smb"] as const)("%s:// → conn_mkdir", async (kind) => {
    mocked.mockImplementation(async () => null);
    await mkdir(`${kind}://id/path/new-dir`);
    expect(invoke).toHaveBeenCalledWith(
      "conn_mkdir",
      expect.objectContaining({ id: "id", path: "/path/new-dir" }),
    );
  });
});

describe("client.createEmptyFile — every remote scheme hits conn_create_empty_file", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// → conn_create_empty_file",
    async (kind) => {
      mocked.mockImplementation(async () => null);
      await createEmptyFile(`${kind}://id/dir/file.txt`);
      expect(invoke).toHaveBeenCalledWith(
        "conn_create_empty_file",
        expect.objectContaining({ id: "id", path: "/dir/file.txt" }),
      );
    },
  );

  it("local → fs_create_empty_file", async () => {
    mocked.mockImplementation(async () => null);
    await createEmptyFile("/local/file.txt");
    expect(invoke).toHaveBeenCalledWith("fs_create_empty_file", {
      path: "/local/file.txt",
    });
  });
});

describe("client.rename — same-backend dispatch for every remote scheme", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s same-id: conn_rename",
    async (kind) => {
      mocked.mockImplementation(async () => null);
      await rename(`${kind}://id-a/foo`, `${kind}://id-a/bar`);
      expect(invoke).toHaveBeenCalledWith(
        "conn_rename",
        expect.objectContaining({ id: "id-a", from: "/foo", to: "/bar" }),
      );
    },
  );

  it("rejects cross-backend rename (sftp ↔ smb)", async () => {
    await expect(rename("sftp://id/a", "smb://id/b")).rejects.toThrow(
      /rename across backends/,
    );
  });

  it("rejects same-kind but different-connection rename (smb)", async () => {
    await expect(
      rename("smb://id-a/foo", "smb://id-b/foo"),
    ).rejects.toThrow(/rename across different smb connections/);
  });
});

describe("client.readText / readBase64 — every remote scheme routes", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// readText → conn_read_text",
    async (kind) => {
      mocked.mockImplementation(async () => "hello");
      const txt = await readText(`${kind}://id/x.txt`);
      expect(txt).toBe("hello");
      expect(invoke).toHaveBeenCalledWith(
        "conn_read_text",
        expect.objectContaining({ id: "id", path: "/x.txt" }),
      );
    },
  );

  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// readBase64 → conn_read_base64",
    async (kind) => {
      mocked.mockImplementation(async () => "dGVzdA==");
      const b64 = await readBase64(`${kind}://id/x.png`);
      expect(b64).toBe("dGVzdA==");
      expect(invoke).toHaveBeenCalledWith(
        "conn_read_base64",
        expect.objectContaining({ id: "id", path: "/x.png" }),
      );
    },
  );
});

describe("client.hashSha256 — SFTP-only remote support", () => {
  it("local → fs_hash_sha256", async () => {
    mocked.mockImplementation(async () => "abc123");
    const h = await hashSha256("/file");
    expect(h).toBe("abc123");
    expect(invoke).toHaveBeenCalledWith("fs_hash_sha256", { path: "/file" });
  });

  it("sftp:// → conn_hash_sha256", async () => {
    mocked.mockImplementation(async () => "deadbeef");
    const h = await hashSha256("sftp://id/file");
    expect(h).toBe("deadbeef");
    expect(invoke).toHaveBeenCalledWith(
      "conn_hash_sha256",
      expect.objectContaining({ id: "id", path: "/file" }),
    );
  });

  it.each(["ftp", "smb"] as const)(
    "%s:// rejects with a typed 'not yet supported' error",
    async (kind) => {
      await expect(hashSha256(`${kind}://id/file`)).rejects.toThrow(
        new RegExp(`not yet supported for ${kind}`),
      );
    },
  );
});

describe("client.dirSummary — SFTP gets real scan, FTP/SMB get zeros", () => {
  it.each(["ftp", "smb"] as const)(
    "%s:// returns conservative zeros without calling conn_dir_summary",
    async (kind) => {
      let dirSummaryHit = false;
      mocked.mockImplementation(async (cmd) => {
        if (cmd === "conn_dir_summary") {
          dirSummaryHit = true;
          throw new Error("should not have been called");
        }
        return null;
      });
      const s = await dirSummary(`${kind}://id/dir`);
      expect(s).toEqual({ entries: 0, totalSize: 0, truncated: false });
      expect(dirSummaryHit).toBe(false);
    },
  );
});

describe("client.removeOrTrashMany — every remote scheme hits conn_remove (no fall-through to fs_trash_many)", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// paths each hit conn_remove (regression for the 0.2.270 SMB CanonicalizePath leak)",
    async (kind) => {
      mocked.mockImplementation(async () => null);
      await removeOrTrashMany([`${kind}://id/a`, `${kind}://id/b`]);
      const calls = mocked.mock.calls.map((c) => c[0]);
      expect(calls).not.toContain("fs_trash_many");
      expect(invoke).toHaveBeenCalledWith(
        "conn_remove",
        expect.objectContaining({ id: "id", path: "/a" }),
      );
      expect(invoke).toHaveBeenCalledWith(
        "conn_remove",
        expect.objectContaining({ id: "id", path: "/b" }),
      );
    },
  );

  it("mixes local + remote correctly in one call", async () => {
    mocked.mockImplementation(async () => null);
    await removeOrTrashMany(["/local", "sftp://id/remote"]);
    expect(invoke).toHaveBeenCalledWith("fs_trash_many", {
      paths: ["/local"],
    });
    expect(invoke).toHaveBeenCalledWith(
      "conn_remove",
      expect.objectContaining({ id: "id", path: "/remote" }),
    );
  });
});

describe("client.permanentlyDeleteMany — every remote scheme hits conn_remove", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// path → conn_remove",
    async (kind) => {
      mocked.mockImplementation(async () => null);
      await permanentlyDeleteMany([`${kind}://id/a`]);
      expect(invoke).toHaveBeenCalledWith(
        "conn_remove",
        expect.objectContaining({ id: "id", path: "/a" }),
      );
    },
  );

  it("local paths hit fs_remove (per-path)", async () => {
    mocked.mockImplementation(async () => null);
    await permanentlyDeleteMany(["/a", "/b"]);
    expect(invoke).toHaveBeenCalledWith("fs_remove", { path: "/a" });
    expect(invoke).toHaveBeenCalledWith("fs_remove", { path: "/b" });
  });
});

describe("client.startSync — every remote scheme picks cross-engine dispatch", () => {
  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// src → sync_start_cross",
    async (kind) => {
      mocked.mockImplementation(async () => "job-2");
      await startSync(`${kind}://id/foo`, "/dest");
      expect(invoke).toHaveBeenCalledWith(
        "sync_start_cross",
        expect.objectContaining({ src: `${kind}://id/foo`, dest: "/dest" }),
      );
    },
  );

  it.each(["sftp", "ftp", "smb"] as const)(
    "%s:// dest → sync_start_cross",
    async (kind) => {
      mocked.mockImplementation(async () => "job-3");
      await startSync("/src", `${kind}://id/dest`);
      expect(invoke).toHaveBeenCalledWith(
        "sync_start_cross",
        expect.objectContaining({ src: "/src", dest: `${kind}://id/dest` }),
      );
    },
  );
});
