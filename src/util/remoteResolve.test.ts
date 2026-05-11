// Tests for the address-bar URL → registered-id resolver (0.2.263).
// Two units under test:
//   - parseHostish: the pure URL-shape parser. Pinned for every auth
//     / port / IPv6 / edge-case input shape so a refactor doesn't
//     silently re-introduce "ftp://host" → "no such connection".
//   - resolveRemoteUrl: the orchestrator that reuses existing
//     connections + auto-creates new ones. We mock the conn API so
//     the test stays a unit test, not an integration test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { __testing__, resolveRemoteUrl } from "./remoteResolve";

vi.mock("../api/conn", () => ({
  connCreateFtp: vi.fn(async () => "deadbeef-0000-0000-0000-aaaaaaaaaaaa"),
  connList: vi.fn(async () => []),
}));

const { parseHostish, findExistingFtp } = __testing__;

describe("parseHostish", () => {
  it("bare host → defaults port 21 + anonymous user", () => {
    expect(parseHostish("ftp.example.com")).toEqual({
      user: "",
      password: "",
      host: "ftp.example.com",
      port: 21,
    });
  });

  it("host:port → parses the port", () => {
    expect(parseHostish("ftp.example.com:2121")).toEqual({
      user: "",
      password: "",
      host: "ftp.example.com",
      port: 2121,
    });
  });

  it("user@host → extracts the user, leaves password empty", () => {
    expect(parseHostish("alice@ftp.example.com")).toEqual({
      user: "alice",
      password: "",
      host: "ftp.example.com",
      port: 21,
    });
  });

  it("user:password@host:port → all four", () => {
    expect(parseHostish("alice:s3cret@ftp.example.com:21")).toEqual({
      user: "alice",
      password: "s3cret",
      host: "ftp.example.com",
      port: 21,
    });
  });

  it("URL-encoded credentials are decoded", () => {
    expect(parseHostish("a%40b:p%40ss@host")).toEqual({
      user: "a@b",
      password: "p@ss",
      host: "host",
      port: 21,
    });
  });

  it("IPv6 in brackets keeps the address, port after the bracket", () => {
    expect(parseHostish("[2001:db8::1]:21")).toEqual({
      user: "",
      password: "",
      host: "2001:db8::1",
      port: 21,
    });
  });

  it("invalid port shapes are best-effort — host kept whole, default port 21", () => {
    // Out-of-range and non-numeric ports both keep the full string
    // as the host and fall back to port 21, so conn_create_ftp gets
    // a chance to surface a clearer DNS / connect error than the
    // parser would. The alternative — returning null and silently
    // ignoring the URL — left users without feedback.
    expect(parseHostish("host:99999")).toEqual({
      user: "",
      password: "",
      host: "host:99999",
      port: 21,
    });
    expect(parseHostish("host:abc")?.host).toBe("host:abc");
  });

  it("empty / dot-only inputs are rejected", () => {
    expect(parseHostish("")).toBeNull();
  });
});

describe("findExistingFtp", () => {
  it("matches the anonymous-style label", () => {
    const conns = [
      { id: "id-1", kind: "ftp", label: "ftp.example.com:21" },
      { id: "id-2", kind: "ftp", label: "alice@ftp.example.com:21" },
    ];
    expect(
      findExistingFtp(conns, {
        user: "",
        password: "",
        host: "ftp.example.com",
        port: 21,
      }),
    ).toBe("id-1");
  });

  it("matches the user@host:port label", () => {
    const conns = [
      { id: "id-1", kind: "ftp", label: "ftp.example.com:21" },
      { id: "id-2", kind: "ftp", label: "alice@ftp.example.com:21" },
    ];
    expect(
      findExistingFtp(conns, {
        user: "alice",
        password: "",
        host: "ftp.example.com",
        port: 21,
      }),
    ).toBe("id-2");
  });

  it("ignores non-ftp kinds (sftp connections never match)", () => {
    const conns = [
      { id: "id-x", kind: "sftp", label: "ftp.example.com:21" },
    ];
    expect(
      findExistingFtp(conns, {
        user: "",
        password: "",
        host: "ftp.example.com",
        port: 21,
      }),
    ).toBeNull();
  });
});

describe("resolveRemoteUrl", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { connCreateFtp, connList } = await import("../api/conn");
    vi.mocked(connCreateFtp).mockResolvedValue(
      "deadbeef-0000-0000-0000-aaaaaaaaaaaa",
    );
    vi.mocked(connList).mockResolvedValue([]);
  });

  it("passes through local paths unchanged", async () => {
    expect(await resolveRemoteUrl("/Users/syle/git")).toBe("/Users/syle/git");
  });

  it("passes through sftp:// unchanged (no anonymous SFTP)", async () => {
    expect(await resolveRemoteUrl("sftp://example.com/")).toBe(
      "sftp://example.com/",
    );
  });

  it("UUID-form FTP URL is a no-op (already canonical)", async () => {
    const u = "ftp://550e8400-e29b-41d4-a716-446655440000/pub";
    expect(await resolveRemoteUrl(u)).toBe(u);
    const { connCreateFtp } = await import("../api/conn");
    expect(connCreateFtp).not.toHaveBeenCalled();
  });

  it("host-form FTP URL → auto-creates and rewrites to UUID form", async () => {
    const out = await resolveRemoteUrl("ftp://ftp.example.com/pub");
    expect(out).toBe(
      "ftp://deadbeef-0000-0000-0000-aaaaaaaaaaaa/pub",
    );
    const { connCreateFtp } = await import("../api/conn");
    expect(connCreateFtp).toHaveBeenCalledWith({
      host: "ftp.example.com",
      port: 21,
      user: undefined,
      password: undefined,
    });
  });

  it("reuses an existing connection with the same label", async () => {
    const { connCreateFtp, connList } = await import("../api/conn");
    vi.mocked(connList).mockResolvedValue([
      {
        id: "existing-uuid",
        kind: "ftp",
        label: "ftp.example.com:21",
      },
    ]);
    const out = await resolveRemoteUrl("ftp://ftp.example.com/pub");
    expect(out).toBe("ftp://existing-uuid/pub");
    expect(connCreateFtp).not.toHaveBeenCalled();
  });

  it("preserves the path tail (including trailing slash defaults)", async () => {
    const out = await resolveRemoteUrl("ftp://192.168.1.1");
    expect(out).toBe(
      "ftp://deadbeef-0000-0000-0000-aaaaaaaaaaaa/",
    );
  });
});
