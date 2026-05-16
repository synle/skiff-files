// Smoke tests for the keychain bindings. The Rust side has its own
// tests (account-name composition, service constant); these are
// here mostly to pin the camelCase serde discriminant used by
// `SecretKind` so a future schema rename can't silently break the
// frontend wiring.
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  credsCapable,
  credsDelete,
  credsLoad,
  credsStore,
} from "./creds";

const mockedInvoke = vi.mocked(invoke);

describe("creds bindings", () => {
  it("credsStore sends camelCase kind to the Rust command", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await credsStore("abc-123", "auth", "secret");
    expect(mockedInvoke).toHaveBeenLastCalledWith("creds_store", {
      connectionId: "abc-123",
      kind: "auth",
      secret: "secret",
    });
  });

  it("credsLoad returns null when Rust resolves to null (no entry)", async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    const got = await credsLoad("missing", "auth");
    expect(got).toBeNull();
  });

  it("credsLoad returns the stored secret on a hit", async () => {
    mockedInvoke.mockResolvedValueOnce("hunter-replacement");
    const got = await credsLoad("hit", "auth");
    expect(got).toBe("hunter-replacement");
  });

  it("credsDelete is idempotent — caller can fire and forget", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await credsDelete("anywhere", "auth");
    expect(mockedInvoke).toHaveBeenLastCalledWith("creds_delete", {
      connectionId: "anywhere",
      kind: "auth",
    });
  });

  it("credsCapable returns the boolean probe result verbatim", async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    expect(await credsCapable()).toBe(true);
    mockedInvoke.mockResolvedValueOnce(false);
    expect(await credsCapable()).toBe(false);
  });

  it("uses the `keyPassphrase` discriminant for SFTP key passphrases", async () => {
    // Currently unused by the dialog (the SFTP key passphrase
    // prompts every connect) — this test pins the JSON shape so
    // we don't drift from `crate::creds::SecretKind` if a future
    // flow starts persisting key passphrases.
    mockedInvoke.mockResolvedValueOnce(undefined);
    await credsStore("ssh-1", "keyPassphrase", "p");
    expect(mockedInvoke).toHaveBeenLastCalledWith("creds_store", {
      connectionId: "ssh-1",
      kind: "keyPassphrase",
      secret: "p",
    });
  });

  // Bug 16 — full Remember-password round-trip. Store, then load,
  // and the same secret comes back. Pins the (kind, connectionId)
  // tuple's role as the keychain key; a refactor that swapped store
  // and load on different keys would surface here as a mismatched
  // round-trip.
  it("round-trips: store followed by load returns the same secret", async () => {
    // Internal map keyed by JSON(connectionId, kind) — simulates the
    // keychain backend.
    const vault = new Map<string, string>();
    const key = (id: string, kind: string) => `${kind}:${id}`;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      const a = args as Record<string, string>;
      if (cmd === "creds_store") {
        vault.set(key(a.connectionId, a.kind), a.secret);
        return undefined;
      }
      if (cmd === "creds_load") {
        return vault.get(key(a.connectionId, a.kind)) ?? null;
      }
      if (cmd === "creds_delete") {
        vault.delete(key(a.connectionId, a.kind));
        return undefined;
      }
      return null;
    });
    await credsStore("rt-1", "auth", "swordfish");
    expect(await credsLoad("rt-1", "auth")).toBe("swordfish");
    // Deleting clears the slot — subsequent load returns null.
    await credsDelete("rt-1", "auth");
    expect(await credsLoad("rt-1", "auth")).toBeNull();
  });

  // Symmetric path — auth and keyPassphrase slots are independent.
  // Storing under one must NOT clobber the other for the same id.
  it("auth and keyPassphrase slots are independent for the same connection id", async () => {
    const vault = new Map<string, string>();
    const key = (id: string, kind: string) => `${kind}:${id}`;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      const a = args as Record<string, string>;
      if (cmd === "creds_store") {
        vault.set(key(a.connectionId, a.kind), a.secret);
        return undefined;
      }
      if (cmd === "creds_load") {
        return vault.get(key(a.connectionId, a.kind)) ?? null;
      }
      return null;
    });
    await credsStore("shared-id", "auth", "auth-secret");
    await credsStore("shared-id", "keyPassphrase", "key-secret");
    expect(await credsLoad("shared-id", "auth")).toBe("auth-secret");
    expect(await credsLoad("shared-id", "keyPassphrase")).toBe("key-secret");
  });
});
