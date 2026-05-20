// Tests pin the canonical URL builder + parser used as the
// `SavedConnection.id` source of truth.
import { describe, expect, it } from "vitest";
import {
  connectionId,
  connectionUrl,
  parseConnectionId,
} from "./connectionUrl";

describe("connectionId", () => {
  it("builds `user@host:port` for non-default port", () => {
    expect(
      connectionId({ kind: "sftp", host: "nas.local", port: 2222, user: "syle" }),
    ).toBe("syle@nas.local:2222");
  });

  it("elides default port per scheme (sftp=22)", () => {
    expect(
      connectionId({ kind: "sftp", host: "nas", port: 22, user: "syle" }),
    ).toBe("syle@nas");
  });

  it("elides default port per scheme (ftp=21)", () => {
    expect(
      connectionId({ kind: "ftp", host: "mirror", port: 21, user: "anonymous" }),
    ).toBe("anonymous@mirror");
  });

  it("elides default port per scheme (smb=445)", () => {
    expect(
      connectionId({ kind: "smb", host: "10.0.0.5", port: 445, user: "admin" }),
    ).toBe("admin@10.0.0.5");
  });

  it("defaults empty SMB user to `guest`", () => {
    expect(
      connectionId({ kind: "smb", host: "nas", port: 445, user: "" }),
    ).toBe("guest@nas");
  });

  it("defaults empty FTP user to `anonymous`", () => {
    expect(
      connectionId({ kind: "ftp", host: "mirror", port: 21, user: "" }),
    ).toBe("anonymous@mirror");
  });
});

describe("connectionUrl", () => {
  it("prefixes the scheme", () => {
    expect(
      connectionUrl({ kind: "smb", host: "nas", port: 445, user: "admin" }),
    ).toBe("smb://admin@nas");
  });

  it("keeps non-default port", () => {
    expect(
      connectionUrl({ kind: "smb", host: "nas", port: 1445, user: "admin" }),
    ).toBe("smb://admin@nas:1445");
  });
});

describe("parseConnectionId", () => {
  it("round-trips with connectionId", () => {
    const ident = { kind: "sftp" as const, host: "nas", port: 2222, user: "syle" };
    const id = connectionId(ident);
    expect(parseConnectionId(id, "sftp")).toEqual(ident);
  });

  it("parses an id missing the port (uses default)", () => {
    expect(parseConnectionId("admin@10.0.0.5", "smb")).toEqual({
      kind: "smb",
      host: "10.0.0.5",
      port: 445,
      user: "admin",
    });
  });

  it("rejects an id without `@`", () => {
    expect(parseConnectionId("just-host", "smb")).toBeNull();
  });

  it("rejects a bogus port", () => {
    expect(parseConnectionId("admin@host:notanumber", "smb")).toBeNull();
  });

  it("rejects an out-of-range port", () => {
    expect(parseConnectionId("admin@host:0", "smb")).toBeNull();
    expect(parseConnectionId("admin@host:99999", "smb")).toBeNull();
  });
});
