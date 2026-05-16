// Regression suite for the SMB-dialog branch bug sweep
// (`fix/smb-dialog-and-build-kind`). Each test pins the root cause
// of a bug we hit during the 2026-05-12 SMB integration push so a
// future refactor — especially the routing-consolidation TODO at the
// top of `src/api/client.ts` — can't silently regress these paths.
//
// Where a fix lives in Rust (e.g. `walk_smb` single-file
// short-circuit), the test exercises the JS contract that depends on
// it (e.g. the `[paste]` flow that calls `clientStat` before
// dispatching) — Rust unit tests for the engine side live in
// `src-tauri/src/sync/backend.rs` once the Docker harness lands.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  loadSmbDrafts,
  saveSmbDrafts,
  matchSmbDraftsForHost,
  type SmbDraft,
} from "./state/connectionDrafts";
import { parseLocation } from "./util/location";
import { parentPath, pathSegments } from "./util/format";

beforeEach(() => {
  // Each test starts from a clean storage so legacy-shape SMB
  // drafts written by one test don't bleed into another's
  // expectations.
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SMB-branch regression — SMB drafts", () => {
  // 0.2.265 shipped the address-bar resolver with a fresh
  // `SmbDraft` shape (`host` instead of `server`); the old
  // ConnectionsPage was still writing under the same storage key
  // with `{ server, share, user }`. Reading those into the new
  // matcher called `undefined.toLowerCase()` and the whole React
  // tree unmounted (the white-screen bug, image #16).
  it("loadSmbDrafts migrates the legacy `server` field to `host`", () => {
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([
        {
          id: "legacy-1",
          label: "admin@192.168.1.1/G",
          // Pre-0.2.265 shape:
          server: "192.168.1.1",
          share: "G",
          user: "admin",
        },
      ]),
    );
    const drafts = loadSmbDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].host).toBe("192.168.1.1");
    expect(drafts[0].share).toBe("G");
    expect(drafts[0].user).toBe("admin");
    // Migration fills sane defaults for fields the legacy shape
    // didn't carry.
    expect(drafts[0].port).toBe(445);
    expect(drafts[0].domain).toBe("");
  });

  it("loadSmbDrafts drops entries that lack any usable host", () => {
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([
        { id: "bad-1", label: "—", share: "G", user: "admin" },
        // Otherwise-valid entry that survives the filter:
        {
          id: "good-1",
          label: "admin@10.0.0.1/G",
          host: "10.0.0.1",
          port: 445,
          share: "G",
          user: "admin",
          domain: "",
        },
      ]),
    );
    const drafts = loadSmbDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("good-1");
  });

  it("matchSmbDraftsForHost is defensive against undefined host (legacy storage shape)", () => {
    // Construct the exact shape that crashed the dialog: a draft
    // whose `host` is undefined because it was written under the
    // old schema and somehow bypassed the migration filter. Without
    // the `!draftHost` guard in `matchesHost`, the
    // `draftHost.toLowerCase()` call throws TypeError and the
    // RemoteConnectDialog's render unmounts the whole tree.
    const malformed = [
      // Cast through unknown to express the runtime shape that the
      // migration filter would normally reject.
      { id: "x", label: "x", share: "", user: "", domain: "", port: 445 } as unknown as SmbDraft,
    ];
    expect(() =>
      matchSmbDraftsForHost(malformed, "192.168.1.1", 445),
    ).not.toThrow();
    expect(matchSmbDraftsForHost(malformed, "192.168.1.1", 445)).toEqual([]);
  });

  it("saveSmbDrafts + loadSmbDrafts round-trip the canonical shape", () => {
    const draft: SmbDraft = {
      id: "smb-1",
      label: "admin@192.168.1.1:445/G",
      host: "192.168.1.1",
      port: 445,
      share: "G",
      user: "admin",
      domain: "",
    };
    saveSmbDrafts([draft]);
    expect(loadSmbDrafts()).toEqual([draft]);
  });
});

describe("SMB-branch regression — parseLocation handles all three remote schemes", () => {
  // Earlier in the session the sidebar built `sftp://<smb-uuid>/`
  // for SMB connections (a hardcoded ternary defaulted non-FTP to
  // sftp). The paste path then resolved the dest as SFTP, looked
  // up the id in the SFTP registry, failed silently, and the user
  // saw "nothing copied". parseLocation IS the canonical splitter
  // every routing call relies on — pin its smb-aware behavior.
  it("smb:// URL parses with backend.kind === 'smb'", () => {
    const loc = parseLocation("smb://3303b0c8-2b8d-480f-a09d-0d5bca0bb6ba/G/path");
    expect(loc.backend.kind).toBe("smb");
    if (loc.backend.kind === "smb") {
      expect(loc.backend.connectionId).toBe(
        "3303b0c8-2b8d-480f-a09d-0d5bca0bb6ba",
      );
    }
    expect(loc.remotePath).toBe("/G/path");
  });

  it("sftp:// URL parses with backend.kind === 'sftp'", () => {
    const loc = parseLocation("sftp://abc/home/syle");
    expect(loc.backend.kind).toBe("sftp");
    if (loc.backend.kind === "sftp") {
      expect(loc.backend.connectionId).toBe("abc");
    }
    expect(loc.remotePath).toBe("/home/syle");
  });

  it("ftp:// URL parses with backend.kind === 'ftp'", () => {
    const loc = parseLocation("ftp://m1/pub");
    expect(loc.backend.kind).toBe("ftp");
    if (loc.backend.kind === "ftp") {
      expect(loc.backend.connectionId).toBe("m1");
    }
    expect(loc.remotePath).toBe("/pub");
  });

  it("local path parses as kind === 'local'", () => {
    const loc = parseLocation("/Users/syle/Desktop");
    expect(loc.backend.kind).toBe("local");
  });
});

describe("SMB-branch regression — client.ts routes SMB through conn_*", () => {
  // The session's most-bitten bug class: a JS helper that only
  // checked `kind === "sftp"` would silently fall through to the
  // local Tauri command for SMB / FTP, which then tried to
  // canonicalize the `smb://…` URL as an OS path and surfaced the
  // user-visible `CanonicalizePath` error (or worse, silently
  // created a literal `smb:/<uuid>/file.txt` directory on disk).
  //
  // These tests stub `@tauri-apps/api/core` and assert each helper
  // calls the connection-routed Tauri command for SMB, not the
  // local one.
  it("mkdir routes SMB through conn_mkdir, not fs_mkdir", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const spy = vi.mocked(invoke);
    spy.mockClear();
    const { mkdir } = await import("./api/client");
    await mkdir("smb://abc/new-folder");
    const cmds = spy.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("conn_mkdir");
    expect(cmds).not.toContain("fs_mkdir");
  });

  it("createEmptyFile routes SMB through conn_create_empty_file, not fs_create_empty_file", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const spy = vi.mocked(invoke);
    spy.mockClear();
    const { createEmptyFile } = await import("./api/client");
    await createEmptyFile("smb://abc/untitled.txt");
    const cmds = spy.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("conn_create_empty_file");
    expect(cmds).not.toContain("fs_create_empty_file");
  });

  it("rename routes same-connection SMB through conn_rename, not fs_rename", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const spy = vi.mocked(invoke);
    spy.mockClear();
    const { rename } = await import("./api/client");
    await rename("smb://abc/a.txt", "smb://abc/b.txt");
    const cmds = spy.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("conn_rename");
    expect(cmds).not.toContain("fs_rename");
  });

  it("rename across different SMB connection ids throws (not a silent fallthrough)", async () => {
    const { rename } = await import("./api/client");
    await expect(
      rename("smb://abc/a.txt", "smb://xyz/b.txt"),
    ).rejects.toThrow(/different smb connections/);
  });

  it("removeOrTrashMany sends SMB paths to conn_remove, not fs_trash_many", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const spy = vi.mocked(invoke);
    spy.mockClear();
    const { removeOrTrashMany } = await import("./api/client");
    await removeOrTrashMany([
      "smb://abc/file-a.png",
      "smb://abc/file-b.png",
    ]);
    const cmds = spy.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("conn_remove");
    expect(cmds).not.toContain("fs_trash_many");
  });

  it("permanentlyDeleteMany sends SMB paths to conn_remove, not fs_remove", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const spy = vi.mocked(invoke);
    spy.mockClear();
    const { permanentlyDeleteMany } = await import("./api/client");
    await permanentlyDeleteMany(["smb://abc/file.png"]);
    const cmds = spy.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("conn_remove");
    expect(cmds).not.toContain("fs_remove");
  });

  it("up-folder navigation never goes past the SMB share root", () => {
    // Image #74-#76 bug: clicking ↑ at `smb://<uuid>/share` first
    // dropped to `smb://<uuid>` (no trailing slash), then to
    // `smb:`, then to local `/`. Root cause was `pathSegments`
    // only handling `sftp://`; ftp:// and smb:// fell into the
    // POSIX branch which produced bogus segments. After the fix
    // parentPath at the share root returns the share root itself.
    const root = "smb://ba47a8e7-cc66-4af6-8d61-093b9b7b2fae/";
    const child = "smb://ba47a8e7-cc66-4af6-8d61-093b9b7b2fae/share/_screenshots";
    const onceUp = "smb://ba47a8e7-cc66-4af6-8d61-093b9b7b2fae/share";
    const twiceUp = "smb://ba47a8e7-cc66-4af6-8d61-093b9b7b2fae/";

    // Two levels deep → one level
    expect(parentPath(child)).toBe(onceUp);
    // One level deep → root
    expect(parentPath(onceUp)).toBe(twiceUp);
    // At root → stays at root (Toolbar disables the button when
    // parentPath === path).
    expect(parentPath(root)).toBe(root);
  });

  it("up-folder navigation never goes past the FTP share root", () => {
    // Same class of bug — ftp:// fell through to the POSIX
    // branch alongside smb://. Pin both schemes.
    const root = "ftp://m1/";
    const child = "ftp://m1/pub/mirror";
    expect(parentPath(child)).toBe("ftp://m1/pub");
    expect(parentPath("ftp://m1/pub")).toBe(root);
    expect(parentPath(root)).toBe(root);
  });

  it("pathSegments produces well-formed segments for smb:// paths", () => {
    // Sanity-check the segment shape PathBar / breadcrumbs render
    // — first segment is the connection root, subsequent segments
    // keep the `smb://<id>` prefix.
    const segs = pathSegments("smb://uuid/share/sub");
    expect(segs).toEqual([
      { label: "uuid", path: "smb://uuid/" },
      { label: "share", path: "smb://uuid/share" },
      { label: "sub", path: "smb://uuid/share/sub" },
    ]);
  });

  it("stat routes SMB through conn_stat, not fs_stat (paste read-side)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const spy = vi.mocked(invoke);
    spy.mockClear();
    // The shared setup mock returns shapes for the common Tauri
    // commands but doesn't know what conn_stat should give back —
    // override per-call so `reshapeRemote` (which post-processes
    // the returned Entry) has a real path to rewrite.
    spy.mockImplementation(async (cmd: string) => {
      if (cmd === "conn_stat") {
        return {
          name: "x.png",
          path: "/x.png",
          isDir: false,
          isSymlink: false,
          size: 0,
          mtime: null,
        };
      }
      return null;
    });
    const { stat } = await import("./api/client");
    await stat("smb://abc/x.png");
    const cmds = spy.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("conn_stat");
    expect(cmds).not.toContain("fs_stat");
  });
});
