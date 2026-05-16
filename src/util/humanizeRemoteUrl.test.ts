// Pins the humanize helpers: swap raw UUIDs in remote URLs / error
// messages for the friendly registry label. Without these tests, the
// regex could silently regress to a no-op the next time someone
// touches the unreachable placeholder.
import { describe, expect, it } from "vitest";
import { humanizeMessage, humanizeRemoteUrl } from "./humanizeRemoteUrl";

const LABELS = new Map<string, string>([
  ["ba47a8e7-cc66-4af6-8d61-093b9b7b2fae", "admin@192.168.1.1:445/G"],
  ["550e8400-e29b-41d4-a716-446655440000", "user@example.com:22"],
]);

describe("humanizeRemoteUrl", () => {
  it("swaps the SMB UUID for the friendly label", () => {
    expect(
      humanizeRemoteUrl(
        "smb://ba47a8e7-cc66-4af6-8d61-093b9b7b2fae/dropbox/code_hobby",
        LABELS,
      ),
    ).toBe("smb://admin@192.168.1.1:445/G/dropbox/code_hobby");
  });

  it("preserves SFTP / FTP scheme prefixes", () => {
    expect(
      humanizeRemoteUrl(
        "sftp://550e8400-e29b-41d4-a716-446655440000/home/user",
        LABELS,
      ),
    ).toBe("sftp://user@example.com:22/home/user");
  });

  it("passes through local paths unchanged", () => {
    expect(humanizeRemoteUrl("/Users/syle/Downloads", LABELS)).toBe(
      "/Users/syle/Downloads",
    );
  });

  it("keeps the raw URL when the connection id is unknown", () => {
    expect(
      humanizeRemoteUrl(
        "smb://00000000-0000-0000-0000-000000000000/share",
        LABELS,
      ),
    ).toBe("smb://00000000-0000-0000-0000-000000000000/share");
  });

  it("handles empty input", () => {
    expect(humanizeRemoteUrl("", LABELS)).toBe("");
  });
});

describe("humanizeMessage", () => {
  it("replaces every UUID occurrence with its friendly label", () => {
    // Error strings sometimes echo the id more than once.
    const msg =
      "connection not found: ba47a8e7-cc66-4af6-8d61-093b9b7b2fae (id=ba47a8e7-cc66-4af6-8d61-093b9b7b2fae)";
    expect(humanizeMessage(msg, LABELS)).toBe(
      "connection not found: admin@192.168.1.1:445/G (id=admin@192.168.1.1:445/G)",
    );
  });

  it("leaves unknown UUIDs untouched", () => {
    const msg =
      "trace id 11111111-2222-3333-4444-555555555555 not in registry";
    expect(humanizeMessage(msg, LABELS)).toBe(msg);
  });

  it("is case-insensitive on hex but preserves the original case in the lookup miss", () => {
    // UUIDs in error messages are usually lowercase, but the regex
    // is case-insensitive so an upper-case echo still matches the
    // pattern. Misses stay verbatim.
    const msg = "ref BA47A8E7-CC66-4AF6-8D61-093B9B7B2FAE is gone";
    // The map is keyed lowercase; an uppercase echo doesn't hit the
    // label and stays as-is. That's the *correct* trade — we don't
    // want surprise normalization.
    expect(humanizeMessage(msg, LABELS)).toBe(msg);
  });

  it("handles empty input", () => {
    expect(humanizeMessage("", LABELS)).toBe("");
  });
});
