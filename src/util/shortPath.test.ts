import { describe, expect, it } from "vitest";
import { pathOriginLabel, shortPath } from "./shortPath";

describe("shortPath", () => {
  const HOME = "/Users/syle";

  it("replaces the home prefix with ~ and abbreviates middle segs", () => {
    expect(
      shortPath("/Users/syle/git/file-explorer/src-tauri/icons/android", HOME),
    ).toBe("~/g/f/s/i/android");
  });

  it("returns ~ for the home dir itself", () => {
    expect(shortPath("/Users/syle", HOME)).toBe("~");
    expect(shortPath("/Users/syle/", HOME)).toBe("~");
  });

  it("keeps absolute non-home paths abbreviated under /", () => {
    // Two-segment path: parent abbreviates to one char, last kept full.
    expect(shortPath("/etc/hosts", "")).toBe("/e/hosts");
    expect(shortPath("/var/log/system.log", "")).toBe("/v/l/system.log");
  });

  it("compacts Windows paths and keeps the drive letter", () => {
    expect(shortPath("c:/Users/Syle/xxx/yyy/zzz", "")).toBe("c:/U/S/x/y/zzz");
    expect(shortPath("C:\\Users\\Syle\\xxx\\yyy\\zzz", "")).toBe(
      "c:/U/S/x/y/zzz",
    );
    expect(shortPath("D:/", "")).toBe("d:/");
  });

  it("compacts remote paths, preserving the scheme://<id>", () => {
    expect(shortPath("sftp://abc-123/home/user/foo/bar", HOME)).toBe(
      "sftp://abc-123/h/u/f/bar",
    );
    expect(shortPath("ftp://m1/pub/file.txt", HOME)).toBe(
      "ftp://m1/p/file.txt",
    );
    expect(shortPath("smb://server/share/dir/file", HOME)).toBe(
      "smb://server/s/d/file",
    );
  });

  it("leaves a remote root unchanged-but-normalized", () => {
    expect(shortPath("sftp://abc/", HOME)).toBe("sftp://abc/");
  });

  it("returns empty when input is empty", () => {
    expect(shortPath("", HOME)).toBe("");
  });

  it("keeps the last segment full even when long", () => {
    expect(
      shortPath("/Users/syle/Downloads/very-long-filename.tar.gz", HOME),
    ).toBe("~/D/very-long-filename.tar.gz");
  });
});

describe("pathOriginLabel", () => {
  it("identifies remote schemes", () => {
    expect(pathOriginLabel("sftp://abc/home")).toBe("SFTP");
    expect(pathOriginLabel("ftp://m/pub")).toBe("FTP");
    expect(pathOriginLabel("smb://s/share")).toBe("SMB");
  });
  it("defaults to Local", () => {
    expect(pathOriginLabel("/Users/syle")).toBe("Local");
    expect(pathOriginLabel("C:/Users/Syle")).toBe("Local");
  });
});
