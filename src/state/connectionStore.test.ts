// Unit tests for the unified saved-connections store. Pins the
// contracts the Manage Connections page + RemoteConnectDialog both
// depend on:
//   - `addOrUpdateConnection` is dedup-by-id (update-in-place
//     preserves the row's identity, even when shape fields change).
//   - `removeConnection` is by-id, leaves siblings alone.
//   - `migrateLegacyDrafts` is idempotent — running it twice with
//     the same localStorage state never duplicates rows, because
//     dedup is by `{kind, host, port, user}`.
//   - Plaintext `password` is wiped on write when `rememberPassword`
//     is false. Defense in depth for the keychain-migration flow.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addOrUpdateConnection,
  findConnectionById,
  findExistingConnection,
  matchConnectionsForHost,
  migrateLegacyDrafts,
  moveConnection,
  removeConnection,
  type SavedConnection,
} from "./connectionStore";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

const sftp: SavedConnection = {
  id: "s-1",
  kind: "sftp",
  label: "user@host:22",
  host: "host",
  port: 22,
  user: "user",
  authMode: "password",
  rememberPassword: false,
};

const ftp: SavedConnection = {
  id: "f-1",
  kind: "ftp",
  label: "anonymous@mirror:21",
  host: "mirror",
  port: 21,
  user: "anonymous",
  rememberPassword: false,
};

describe("addOrUpdateConnection", () => {
  it("appends a new entry when the id isn't present", () => {
    const out = addOrUpdateConnection([sftp], ftp);
    expect(out).toHaveLength(2);
    expect(findConnectionById(out, "s-1")).toBeDefined();
    expect(findConnectionById(out, "f-1")).toBeDefined();
  });

  // Bug 14 — Edit-mode round-trip must preserve the row's id so
  // every other surface keyed on id (keychain entries,
  // `editingConnectionId`, the live registry's `liveById` map)
  // points at the same row. Pin update-in-place explicitly.
  it("update-in-place preserves the row's id when fields change", () => {
    const initial = [sftp];
    const renamed: SavedConnection = {
      ...sftp,
      label: "renamed@host:22",
      user: "renamed",
      host: "host2",
    };
    const out = addOrUpdateConnection(initial, renamed);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s-1");
    expect(out[0].label).toBe("renamed@host:22");
    expect(out[0].user).toBe("renamed");
    expect(out[0].host).toBe("host2");
  });

  it("never mutates the input array — returns a fresh array", () => {
    const initial = [sftp];
    const out = addOrUpdateConnection(initial, ftp);
    expect(out).not.toBe(initial);
    expect(initial).toHaveLength(1);
  });

  // Defense — when `rememberPassword` is false the `password` field
  // must be wiped before write so a stale value can't ride along
  // into settings.json.
  it("strips plaintext password when rememberPassword is false", () => {
    const stale: SavedConnection = {
      ...sftp,
      rememberPassword: false,
      password: "should-not-persist",
    };
    const [out] = addOrUpdateConnection([], stale);
    expect(out.password).toBeUndefined();
  });

  // Symmetric path — when the toggle is ON, the password rides
  // through. (The keychain-first flow keeps `password` set only
  // when the keychain refused; this contract covers that fallback.)
  it("preserves plaintext password when rememberPassword is true", () => {
    const remembered: SavedConnection = {
      ...sftp,
      rememberPassword: true,
      password: "keep-me",
    };
    const [out] = addOrUpdateConnection([], remembered);
    expect(out.password).toBe("keep-me");
  });
});

describe("removeConnection", () => {
  it("removes only the matching id", () => {
    const out = removeConnection([sftp, ftp], "s-1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("f-1");
  });

  it("is a no-op on an unknown id", () => {
    const out = removeConnection([sftp], "does-not-exist");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s-1");
  });
});

describe("migrateLegacyDrafts — idempotency (Bug 13)", () => {
  it("running migration twice does not duplicate rows", () => {
    // Seed legacy SFTP + FTP keys.
    localStorage.setItem(
      "skiff-files.connections.v1",
      JSON.stringify([
        {
          id: "legacy-sftp",
          label: "legacy@host:22",
          host: "host",
          port: 22,
          user: "legacy",
          authMode: "password",
        },
      ]),
    );
    localStorage.setItem(
      "skiff-files.connections.ftp.v1",
      JSON.stringify([
        {
          id: "legacy-ftp",
          label: "anon@mirror:21",
          host: "mirror",
          port: 21,
          user: "anonymous",
        },
      ]),
    );
    const first = migrateLegacyDrafts([]);
    expect(first).toHaveLength(2);
    // Second run with the same legacy state + the merged list —
    // must NOT double up. Dedup is by `{kind, host, port, user}`.
    const second = migrateLegacyDrafts(first);
    expect(second).toHaveLength(2);
    const ids = second.map((c) => c.id).sort();
    expect(ids).toEqual(["legacy-ftp", "legacy-sftp"]);
  });

  it("dedups when an existing entry already covers the legacy row", () => {
    // Existing has the same (kind, host, port, user) triplet that
    // legacy carries — migration must drop the legacy duplicate.
    const existing: SavedConnection = {
      id: "existing-sftp",
      kind: "sftp",
      label: "user@host:22",
      host: "host",
      port: 22,
      user: "user",
      rememberPassword: false,
    };
    localStorage.setItem(
      "skiff-files.connections.v1",
      JSON.stringify([
        {
          id: "legacy-sftp",
          label: "user@host:22",
          host: "host",
          port: 22,
          user: "user",
          authMode: "password",
        },
      ]),
    );
    const out = migrateLegacyDrafts([existing]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("existing-sftp");
  });
});

describe("matchConnectionsForHost", () => {
  it("filters by kind + host + port triple", () => {
    const list: SavedConnection[] = [
      sftp,
      { ...sftp, id: "s-2", port: 2222 },
      ftp,
    ];
    expect(matchConnectionsForHost(list, "sftp", "host", 22)).toHaveLength(1);
    expect(matchConnectionsForHost(list, "sftp", "host", 2222)).toHaveLength(1);
    // Wrong kind → no match.
    expect(matchConnectionsForHost(list, "ftp", "host", 22)).toHaveLength(0);
  });

  it("port=null matches any port on the host", () => {
    const list: SavedConnection[] = [
      sftp,
      { ...sftp, id: "s-2", port: 2222 },
    ];
    expect(matchConnectionsForHost(list, "sftp", "host", null)).toHaveLength(2);
  });

  it("host match is case-insensitive", () => {
    expect(
      matchConnectionsForHost([sftp], "sftp", "HOST", 22),
    ).toHaveLength(1);
  });
});

describe("findExistingConnection", () => {
  // 0.2.307 — Connect dialog uses this to dedupe a re-connect against
  // an existing saved row. Without dedup, re-typing the same SMB
  // host/user/share spawns a second row + a second live registry
  // slot, which shows as two near-identical rows in the sidebar.
  const smbA: SavedConnection = {
    id: "smb-existing",
    kind: "smb",
    label: "admin@192.168.1.1:445",
    host: "192.168.1.1",
    port: 445,
    user: "admin",
    share: "G",
    domain: "",
    rememberPassword: false,
  };

  it("matches by kind/host/port/user/share/domain — case-insensitive host + user", () => {
    expect(
      findExistingConnection([smbA], {
        kind: "smb",
        host: "192.168.1.1",
        port: 445,
        user: "ADMIN",
        share: "G",
        domain: "",
      }),
    ).toBe(smbA);
  });

  it("treats undefined share/domain as equivalent to empty string", () => {
    // Real RemoteConnectDialog calls pass `undefined` for SFTP/FTP
    // (no share concept) and empty string for SMB no-share-bound
    // mode. They should not be distinct identities.
    expect(
      findExistingConnection([smbA], {
        kind: "smb",
        host: "192.168.1.1",
        port: 445,
        user: "admin",
        share: undefined,
        domain: undefined,
      }),
    ).toBeUndefined(); // share differs ("G" vs "")
  });

  it("different share on same host:port:user is a separate identity", () => {
    expect(
      findExistingConnection([smbA], {
        kind: "smb",
        host: "192.168.1.1",
        port: 445,
        user: "admin",
        share: "OtherShare",
        domain: "",
      }),
    ).toBeUndefined();
  });

  it("excludes a row by id (edit-mode shouldn't self-match)", () => {
    expect(
      findExistingConnection(
        [smbA],
        {
          kind: smbA.kind,
          host: smbA.host,
          port: smbA.port,
          user: smbA.user,
          share: smbA.share,
          domain: smbA.domain,
        },
        smbA.id,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when no row matches", () => {
    expect(
      findExistingConnection([smbA], {
        kind: "ftp",
        host: "192.168.1.1",
        port: 445,
        user: "admin",
        share: undefined,
        domain: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("moveConnection", () => {
  const a: SavedConnection = { ...sftp, id: "a" };
  const b: SavedConnection = { ...sftp, id: "b" };
  const c: SavedConnection = { ...sftp, id: "c" };

  it("swaps with the previous row when dir = -1", () => {
    const out = moveConnection([a, b, c], "b", -1);
    expect(out.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("swaps with the next row when dir = +1", () => {
    const out = moveConnection([a, b, c], "b", 1);
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("returns the same array reference when moving the first row up", () => {
    const list = [a, b, c];
    expect(moveConnection(list, "a", -1)).toBe(list);
  });

  it("returns the same array reference when moving the last row down", () => {
    const list = [a, b, c];
    expect(moveConnection(list, "c", 1)).toBe(list);
  });

  it("returns the same array reference when the id isn't present", () => {
    const list = [a, b];
    expect(moveConnection(list, "missing", 1)).toBe(list);
  });

  it("never mutates the input array", () => {
    const list = [a, b, c];
    const before = list.map((x) => x.id);
    moveConnection(list, "b", 1);
    expect(list.map((x) => x.id)).toEqual(before);
  });
});
