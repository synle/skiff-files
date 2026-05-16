// Pins the URL translation contract: internal `<scheme>://<uuid>/...`
// must never leak to the OS handler. Without these tests a future
// refactor could accidentally feed the UUID through Tauri's
// open-with-default-app shim and surface a "server not found"
// error from macOS / Windows Explorer.
import { describe, expect, it } from "vitest";
import type { SavedConnection } from "../state/connectionStore";
import { toNativeRemoteUrl } from "./nativeRemoteUrl";

const SMB_BOUND: SavedConnection = {
  id: "smb-1",
  kind: "smb",
  label: "admin@nas:445/Public",
  host: "nas.local",
  port: 445,
  user: "admin",
  share: "Public",
  rememberPassword: false,
};

const SMB_AGNOSTIC: SavedConnection = {
  id: "smb-2",
  kind: "smb",
  label: "admin@nas",
  host: "nas.local",
  port: 445,
  user: "admin",
  share: "",
  rememberPassword: false,
};

const SFTP_1: SavedConnection = {
  id: "sftp-1",
  kind: "sftp",
  label: "user@example.com:22",
  host: "example.com",
  port: 22,
  user: "user",
  rememberPassword: false,
};

const FTP_1: SavedConnection = {
  id: "ftp-1",
  kind: "ftp",
  label: "mirror",
  host: "mirror.example.com",
  port: 21,
  user: "anonymous",
  rememberPassword: false,
};

describe("toNativeRemoteUrl", () => {
  it("passes local paths through unchanged", () => {
    expect(toNativeRemoteUrl("/Users/syle/file.txt", [])).toEqual({
      url: "/Users/syle/file.txt",
    });
  });

  it("translates bound-share SMB by injecting the share back", () => {
    // Internal URL has the form `smb://uuid/<rel>` because the
    // connection bound `share=Public` at session-setup.
    const got = toNativeRemoteUrl(
      "smb://smb-1/folder/file.png",
      [SMB_BOUND],
    );
    expect(got.url).toBe("smb://admin@nas.local/Public/folder/file.png");
  });

  it("translates share-agnostic SMB preserving the share segment", () => {
    // Internal URL has the form `smb://uuid/<share>/<rel>` because
    // the connection didn't bind a share at setup.
    const got = toNativeRemoteUrl(
      "smb://smb-2/Public/folder/file.png",
      [SMB_AGNOSTIC],
    );
    expect(got.url).toBe("smb://admin@nas.local/Public/folder/file.png");
  });

  it("includes the SMB port suffix only when non-default", () => {
    const conn: SavedConnection = { ...SMB_BOUND, port: 1445 };
    const got = toNativeRemoteUrl("smb://smb-1/sub/a.txt", [conn]);
    expect(got.url).toBe("smb://admin@nas.local:1445/Public/sub/a.txt");
  });

  it("omits user@ when no user is set", () => {
    const conn: SavedConnection = { ...SMB_BOUND, user: "" };
    const got = toNativeRemoteUrl("smb://smb-1/file.txt", [conn]);
    expect(got.url).toBe("smb://nas.local/Public/file.txt");
  });

  it("URL-encodes user names that contain special chars", () => {
    const conn: SavedConnection = { ...SMB_BOUND, user: "Sy Le" };
    const got = toNativeRemoteUrl("smb://smb-1/file.txt", [conn]);
    expect(got.url).toBe("smb://Sy%20Le@nas.local/Public/file.txt");
  });

  it("returns null + reason for SFTP (no native handler)", () => {
    const got = toNativeRemoteUrl("sftp://sftp-1/home/file.txt", [SFTP_1]);
    expect(got.url).toBeNull();
    expect(got.reason).toMatch(/SFTP/);
  });

  it("returns null + reason for FTP (no native handler)", () => {
    const got = toNativeRemoteUrl("ftp://ftp-1/pub/file.txt", [FTP_1]);
    expect(got.url).toBeNull();
    expect(got.reason).toMatch(/FTP/);
  });

  it("returns null when the connection id is unknown", () => {
    const got = toNativeRemoteUrl(
      "smb://00000000-0000-0000-0000-000000000000/x",
      [SMB_BOUND],
    );
    expect(got.url).toBeNull();
    expect(got.reason).toMatch(/Unknown connection/);
  });
});
