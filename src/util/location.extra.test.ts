import { describe, expect, it } from "vitest";
import {
  formatLocation,
  formatSmb,
  isRemote,
  parseLocation,
} from "./location";

describe("location — SMB backend", () => {
  it("parseLocation routes smb:// to the smb backend", () => {
    expect(parseLocation("smb://nas-1/Public/dir")).toEqual({
      backend: { kind: "smb", connectionId: "nas-1" },
      remotePath: "/Public/dir",
    });
  });

  it("parseLocation treats a bare smb:// as the root", () => {
    expect(parseLocation("smb://nas-1")).toEqual({
      backend: { kind: "smb", connectionId: "nas-1" },
      remotePath: "/",
    });
    expect(parseLocation("smb://nas-1/")).toEqual({
      backend: { kind: "smb", connectionId: "nas-1" },
      remotePath: "/",
    });
  });

  it("formatSmb normalizes a missing leading slash", () => {
    expect(formatSmb("nas-1", "Public/x")).toBe("smb://nas-1/Public/x");
    expect(formatSmb("nas-1", "/Public/x")).toBe("smb://nas-1/Public/x");
  });

  it("formatLocation round-trips smb", () => {
    const orig = "smb://nas-1/Public/dir";
    expect(formatLocation(parseLocation(orig))).toBe(orig);
  });

  it("isRemote recognizes smb://", () => {
    expect(isRemote("smb://nas-1/")).toBe(true);
  });
});
