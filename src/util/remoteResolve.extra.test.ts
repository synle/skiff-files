// Branch-coverage pad for remoteResolve.ts. The base suite covers
// parseHostish + resolveRemoteUrl happy paths and the existing-
// connection reuse branch. These add:
//   - parseHostish bracket-IPv6 with missing close-bracket and
//     malformed port suffix
//   - parseHostish "[ipv6]" without trailing port (no colon after `]`)
//   - parseRemoteUrl smb:// branch (the base suite skipped it because
//     SMB used to go through a different path)
//   - resolveRemoteUrl when connList throws — must still fall through
//     to connCreateFtp rather than blowing up
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  __testing__,
  parseRemoteUrl,
  resolveRemoteUrl,
} from "./remoteResolve";

vi.mock("../api/conn", () => ({
  connCreateFtp: vi.fn(async () => "deadbeef-0000-0000-0000-aaaaaaaaaaaa"),
  connList: vi.fn(async () => []),
}));

const { parseHostish } = __testing__;

describe("parseHostish — IPv6 corners", () => {
  it("returns null when the bracket is opened but never closed", () => {
    // Without the explicit guard, the helper would read past the end
    // of the host portion and produce a garbage `host` field.
    expect(parseHostish("[2001:db8::1")).toBeNull();
  });

  it("accepts [ipv6] without any port suffix", () => {
    // The bracket path with no trailing `:NNN` — defaults to port 21.
    expect(parseHostish("[2001:db8::1]")).toEqual({
      user: "",
      password: "",
      host: "2001:db8::1",
      port: 21,
    });
  });

  it("rejects out-of-range port after [ipv6]:", () => {
    // Port > 65535 → null bubble; the caller treats this as "skip
    // auto-resolve, let the user see a clearer error from connect".
    expect(parseHostish("[2001:db8::1]:99999")).toBeNull();
  });
});

describe("parseRemoteUrl — smb:// scheme", () => {
  it("parses smb://host/share/path the same shape as ftp/sftp", () => {
    // PathBar dispatches on this shape to know whether to open
    // RemoteConnectDialog. SMB used to be routed differently — pin
    // the contract that smb:// now follows the same parse shape.
    expect(parseRemoteUrl("smb://nas.local/Public/folder")).toEqual({
      scheme: "smb",
      host: "nas.local",
      port: null,
      user: undefined,
      remotePath: "/Public/folder",
    });
  });

  it("returns null for canonical UUID-form smb URLs", () => {
    expect(
      parseRemoteUrl("smb://550e8400-e29b-41d4-a716-446655440000/Public"),
    ).toBeNull();
  });
});

describe("resolveRemoteUrl — connList resilience", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { connCreateFtp, connList } = await import("../api/conn");
    vi.mocked(connCreateFtp).mockResolvedValue(
      "deadbeef-0000-0000-0000-aaaaaaaaaaaa",
    );
    // Make connList throw — the orchestrator must still fall through
    // to the auto-create path rather than aborting the navigation.
    vi.mocked(connList).mockRejectedValue(new Error("connList failed"));
  });

  it("falls through to auto-create when connList throws", async () => {
    const out = await resolveRemoteUrl("ftp://anon.example/pub");
    expect(out).toBe("ftp://deadbeef-0000-0000-0000-aaaaaaaaaaaa/pub");
    const { connCreateFtp } = await import("../api/conn");
    expect(connCreateFtp).toHaveBeenCalled();
  });
});
