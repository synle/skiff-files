import { describe, it, expect } from "vitest";
import {
  formatFtp,
  formatLocation,
  formatSftp,
  isRemote,
  parseLocation,
} from "./location";

describe("parseLocation", () => {
  it("treats a POSIX path as local", () => {
    expect(parseLocation("/Users/syle/git")).toEqual({
      backend: { kind: "local" },
      remotePath: "/Users/syle/git",
    });
  });

  it("treats a Windows path as local", () => {
    expect(parseLocation("C:\\Users\\syle")).toEqual({
      backend: { kind: "local" },
      remotePath: "C:\\Users\\syle",
    });
  });

  it("parses an sftp scheme with a path", () => {
    expect(parseLocation("sftp://abc-123/home/foo")).toEqual({
      backend: { kind: "sftp", connectionId: "abc-123" },
      remotePath: "/home/foo",
    });
  });

  it("parses an sftp scheme with no path as the remote root", () => {
    expect(parseLocation("sftp://abc-123/")).toEqual({
      backend: { kind: "sftp", connectionId: "abc-123" },
      remotePath: "/",
    });
    expect(parseLocation("sftp://abc-123")).toEqual({
      backend: { kind: "sftp", connectionId: "abc-123" },
      remotePath: "/",
    });
  });

  it("parses an ftp scheme with a path", () => {
    expect(parseLocation("ftp://mirror/pub/linux")).toEqual({
      backend: { kind: "ftp", connectionId: "mirror" },
      remotePath: "/pub/linux",
    });
  });

  it("parses an ftp scheme with no path as the remote root", () => {
    expect(parseLocation("ftp://m/")).toEqual({
      backend: { kind: "ftp", connectionId: "m" },
      remotePath: "/",
    });
    expect(parseLocation("ftp://m")).toEqual({
      backend: { kind: "ftp", connectionId: "m" },
      remotePath: "/",
    });
  });
});

describe("formatFtp", () => {
  it("normalizes leading slash", () => {
    expect(formatFtp("m", "pub/x")).toBe("ftp://m/pub/x");
    expect(formatFtp("m", "/pub/x")).toBe("ftp://m/pub/x");
  });
});

describe("formatSftp", () => {
  it("normalizes leading slash", () => {
    expect(formatSftp("abc", "home/x")).toBe("sftp://abc/home/x");
    expect(formatSftp("abc", "/home/x")).toBe("sftp://abc/home/x");
  });
});

describe("formatLocation", () => {
  it("round-trips local", () => {
    const orig = "/x/y";
    expect(formatLocation(parseLocation(orig))).toBe(orig);
  });

  it("round-trips sftp", () => {
    const orig = "sftp://abc/home/x";
    expect(formatLocation(parseLocation(orig))).toBe(orig);
  });

  it("round-trips ftp", () => {
    const orig = "ftp://mirror/pub/linux";
    expect(formatLocation(parseLocation(orig))).toBe(orig);
  });
});

describe("isRemote", () => {
  it("detects sftp + ftp paths", () => {
    expect(isRemote("sftp://abc/")).toBe(true);
    expect(isRemote("ftp://m/")).toBe(true);
    expect(isRemote("/Users")).toBe(false);
    expect(isRemote("C:\\")).toBe(false);
    expect(isRemote("")).toBe(false);
  });
});
