import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadFtpDrafts,
  loadSftpDrafts,
  loadSmbDrafts,
  matchFtpDraftsForHost,
  matchSftpDraftsForHost,
  matchSmbDraftsForHost,
  saveFtpDrafts,
  saveSftpDrafts,
  saveSmbDrafts,
  type FtpDraft,
  type SftpDraft,
  type SmbDraft,
} from "./connectionDrafts";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const sftp = (over: Partial<SftpDraft> = {}): SftpDraft => ({
  id: "s-1",
  label: "test sftp",
  host: "example.com",
  port: 22,
  user: "user",
  authMode: "password",
  ...over,
});

const ftp = (over: Partial<FtpDraft> = {}): FtpDraft => ({
  id: "f-1",
  label: "test ftp",
  host: "ftp.example.com",
  port: 21,
  user: "anonymous",
  ...over,
});

const smb = (over: Partial<SmbDraft> = {}): SmbDraft => ({
  id: "m-1",
  label: "test smb",
  host: "nas.lan",
  port: 445,
  share: "Public",
  user: "guest",
  domain: "",
  ...over,
});

describe("connectionDrafts: load / save round-trip", () => {
  it("sftp drafts round-trip through localStorage", () => {
    const drafts = [sftp(), sftp({ id: "s-2", host: "two.example.com" })];
    saveSftpDrafts(drafts);
    expect(loadSftpDrafts()).toEqual(drafts);
  });

  it("ftp drafts round-trip", () => {
    saveFtpDrafts([ftp()]);
    expect(loadFtpDrafts()).toEqual([ftp()]);
  });

  it("smb drafts round-trip", () => {
    saveSmbDrafts([smb()]);
    expect(loadSmbDrafts()).toEqual([smb()]);
  });

  it("load returns [] when the key is missing", () => {
    expect(loadSftpDrafts()).toEqual([]);
    expect(loadFtpDrafts()).toEqual([]);
    expect(loadSmbDrafts()).toEqual([]);
  });

  it("load returns [] when the stored JSON is corrupt (rule 11: narrow catch on parse)", () => {
    localStorage.setItem("skiff-files.connections.v1", "{not-json");
    expect(loadSftpDrafts()).toEqual([]);
  });

  it("save silently drops on quota / private-mode (no throw)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveSftpDrafts([sftp()])).not.toThrow();
    spy.mockRestore();
  });
});

describe("connectionDrafts: matchesHost", () => {
  it("matches case-insensitively on host", () => {
    const list = [sftp({ host: "Example.COM", port: 22 })];
    expect(matchSftpDraftsForHost(list, "example.com", 22)).toHaveLength(1);
    expect(matchSftpDraftsForHost(list, "EXAMPLE.com", 22)).toHaveLength(1);
  });

  it("returns every port on the same host when port is null", () => {
    const list = [
      sftp({ id: "a", host: "h", port: 22 }),
      sftp({ id: "b", host: "h", port: 2222 }),
      sftp({ id: "c", host: "other", port: 22 }),
    ];
    expect(matchSftpDraftsForHost(list, "h", null).map((d) => d.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("filters to the exact port when a port is supplied", () => {
    const list = [
      ftp({ id: "a", host: "h", port: 21 }),
      ftp({ id: "b", host: "h", port: 2121 }),
    ];
    expect(matchFtpDraftsForHost(list, "h", 21).map((d) => d.id)).toEqual([
      "a",
    ]);
  });

  it("smb match runs through the same case-insensitive predicate", () => {
    const list = [smb({ host: "NAS.lan", port: 445 })];
    expect(matchSmbDraftsForHost(list, "nas.lan", 445)).toHaveLength(1);
    expect(matchSmbDraftsForHost(list, "nas.lan", 4451)).toHaveLength(0);
  });

  it("returns an empty array when nothing matches (symmetric to the match case)", () => {
    expect(matchSftpDraftsForHost([sftp({ host: "a" })], "b", null)).toEqual(
      [],
    );
  });
});
