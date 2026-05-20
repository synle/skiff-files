// Unified saved-connections store. Replaces the three per-kind
// localStorage keys (`skiff-files.connections.v1` for SFTP,
// `.ftp.v1`, `.smb.v1`) that the dialog + ConnectionsPage previously
// juggled.
//
// Why one list: the UI splits "Active connections" vs "Saved" today,
// which is confusing — they live in different stores even though
// users think of them as the same thing. Merging into a single
// `connections` field on Settings (persisted via the existing
// settings.json mirror) means: one list, one row per saved entry,
// status pill ("Connected" / "Disconnected") computed at render
// time from `connList()`.
//
// Password storage (phase 1, plaintext-in-settings.json): when a
// connection's `rememberPassword` flag is true, the password is
// persisted on this struct alongside the other fields. This is the
// stopgap before OS-keychain integration (planned follow-up — see
// the `keyring` crate plan in the project's TODO). Plaintext on
// disk is acceptable in the short term because settings.json lives
// in `app_data_dir` (per-user OS-protected dir), not the source
// tree, but keychain is the right long-term home.

import type {
  FtpDraft,
  SftpDraft,
  SmbDraft,
} from "./connectionDrafts";

/** Mirror of `crate::fs::registry::ConnectionKind`. */
export type ConnectionKind = "sftp" | "ftp" | "smb";

/** SFTP auth mode — same enum the dialog already used; kept here so
 *  callers don't need a second import. */
export type SftpAuthMode = "password" | "privateKey" | "agent";

/** Unified saved-connection shape. Each field is optional except
 *  the discriminator + connection identity (id, kind, host, port,
 *  user). Per-kind fields (`share`, `domain`, `authMode`,
 *  `privateKeyPath`) are populated only when relevant. */
export interface SavedConnection {
  id: string;
  kind: ConnectionKind;
  /** Friendly display label, e.g. `admin@192.168.1.1:445/G`. The UI
   *  renders this verbatim; format is up to whoever inserted the
   *  entry. */
  label: string;
  host: string;
  port: number;
  user: string;
  // SFTP-only.
  authMode?: SftpAuthMode;
  privateKeyPath?: string;
  // SMB-only.
  share?: string;
  domain?: string;
  /** When true, `password` is persisted to settings.json. Default
   *  false so existing users + brand-new connections both default
   *  to "prompt every time" (no silent password capture). The
   *  dialog surfaces a toggle to opt in.
   *
   *  Phase 1: plaintext alongside the other fields.
   *  Phase 2 (planned): swap to `keyring` crate → macOS Keychain /
   *  Windows Credential Manager / Linux libsecret.
   */
  rememberPassword?: boolean;
  /** Plaintext password / passphrase. Only present when
   *  `rememberPassword === true`. Stripped on read when the toggle
   *  is off, so we don't leak through stale settings. */
  password?: string;
  /** When true, the connection is re-opened automatically on app
   *  start. Only honored when `rememberPassword` is also true (or
   *  the kind doesn't require a password — e.g. SSH-agent SFTP),
   *  because we can't reconnect silently without credentials. New
   *  rows default to false; users opt in from the connect dialog or
   *  the Manage Connections row. */
  autoConnect?: boolean;
}

const LEGACY_SFTP_KEY = "skiff-files.connections.v1";
const LEGACY_FTP_KEY = "skiff-files.connections.ftp.v1";
const LEGACY_SMB_KEY = "skiff-files.connections.smb.v1";

/** Project an `SftpDraft` into the unified shape. Used by the
 *  migration + by the back-compat shims in `connectionDrafts.ts`. */
export function sftpToConn(d: SftpDraft): SavedConnection {
  return {
    id: d.id,
    kind: "sftp",
    label: d.label,
    host: d.host,
    port: d.port,
    user: d.user,
    authMode: d.authMode,
    privateKeyPath: d.privateKeyPath,
    rememberPassword: false,
  };
}

export function ftpToConn(d: FtpDraft): SavedConnection {
  return {
    id: d.id,
    kind: "ftp",
    label: d.label,
    host: d.host,
    port: d.port,
    user: d.user,
    rememberPassword: false,
  };
}

export function smbToConn(d: SmbDraft): SavedConnection {
  return {
    id: d.id,
    kind: "smb",
    label: d.label,
    host: d.host,
    port: d.port,
    user: d.user,
    share: d.share,
    domain: d.domain,
    rememberPassword: false,
  };
}

/** Back-projection — needed by callsites that haven't migrated yet
 *  (the address-bar resolver, draft autocomplete in the dialog).
 *  Drops the password field. */
export function connToSftpDraft(c: SavedConnection): SftpDraft | null {
  if (c.kind !== "sftp") return null;
  return {
    id: c.id,
    label: c.label,
    host: c.host,
    port: c.port,
    user: c.user,
    authMode: c.authMode ?? "password",
    privateKeyPath: c.privateKeyPath,
  };
}

export function connToFtpDraft(c: SavedConnection): FtpDraft | null {
  if (c.kind !== "ftp") return null;
  return {
    id: c.id,
    label: c.label,
    host: c.host,
    port: c.port,
    user: c.user,
  };
}

export function connToSmbDraft(c: SavedConnection): SmbDraft | null {
  if (c.kind !== "smb") return null;
  return {
    id: c.id,
    label: c.label,
    host: c.host,
    port: c.port,
    user: c.user,
    share: c.share ?? "",
    domain: c.domain ?? "",
  };
}

/** Read a legacy per-kind list out of localStorage. Returns `[]` on
 *  any error / absence. Used only by `migrateLegacyDrafts`. */
function readLegacyJson<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

/** One-time migration: fold any legacy per-kind drafts from the old
 *  storage keys into a unified list. Idempotent — running it twice
 *  is a no-op because we dedup by host+port+user+kind.
 *
 *  `existing` is the current `Settings.connections` array. The
 *  return value is the merged list (input + migrated). Callers MUST
 *  write the result back to settings and (optionally) delete the
 *  legacy keys. Old keys are kept around for now in case a
 *  downgrade scenario needs them — they're harmless. */
export function migrateLegacyDrafts(
  existing: SavedConnection[],
): SavedConnection[] {
  const merged: SavedConnection[] = [...existing];
  const seen = new Set(merged.map(connKey));
  for (const d of readLegacyJson<SftpDraft>(LEGACY_SFTP_KEY)) {
    const conn = sftpToConn(d);
    if (!seen.has(connKey(conn))) {
      merged.push(conn);
      seen.add(connKey(conn));
    }
  }
  for (const d of readLegacyJson<FtpDraft>(LEGACY_FTP_KEY)) {
    const conn = ftpToConn(d);
    if (!seen.has(connKey(conn))) {
      merged.push(conn);
      seen.add(connKey(conn));
    }
  }
  // SMB legacy shape had a `server` field in some older versions —
  // tolerate it during migration. Anything we can't decode is
  // dropped (the entry is unrecoverable).
  const rawSmb = readLegacyJson<Record<string, unknown>>(LEGACY_SMB_KEY);
  for (const r of rawSmb) {
    const host =
      typeof r.host === "string"
        ? r.host
        : typeof r.server === "string"
          ? r.server
          : "";
    if (!host) continue;
    const conn: SavedConnection = {
      id: typeof r.id === "string" ? r.id : `smb-${Date.now()}-${Math.random()}`,
      kind: "smb",
      label: typeof r.label === "string" ? r.label : "",
      host,
      port: typeof r.port === "number" ? r.port : 445,
      user: typeof r.user === "string" ? r.user : "",
      share: typeof r.share === "string" ? r.share : "",
      domain: typeof r.domain === "string" ? r.domain : "",
      rememberPassword: false,
    };
    if (!seen.has(connKey(conn))) {
      merged.push(conn);
      seen.add(connKey(conn));
    }
  }
  return merged;
}

/** Dedup key. Two entries are "the same connection" iff they target
 *  the same protocol + host:port + user. Share / domain / authMode
 *  variations under the same identity are intentionally collapsed
 *  (the user wanted ONE entry per host:port:user; pick whichever
 *  came last via the migration order). */
function connKey(c: SavedConnection): string {
  return `${c.kind}:${c.host.toLowerCase()}:${c.port}:${c.user.toLowerCase()}`;
}

/** Add or replace a connection in the list. Replacement matches on
 *  `id`; missing id treated as new. Returns a new array (does not
 *  mutate). */
export function addOrUpdateConnection(
  list: SavedConnection[],
  conn: SavedConnection,
): SavedConnection[] {
  const idx = list.findIndex((c) => c.id === conn.id);
  // Defensive: strip `password` when rememberPassword is false so we
  // never silently persist a stale value.
  const sanitized: SavedConnection = conn.rememberPassword
    ? { ...conn }
    : { ...conn, password: undefined };
  if (idx >= 0) {
    const out = [...list];
    out[idx] = sanitized;
    return out;
  }
  return [...list, sanitized];
}

/** Remove a connection by id. Returns a new array. */
export function removeConnection(
  list: SavedConnection[],
  id: string,
): SavedConnection[] {
  return list.filter((c) => c.id !== id);
}

/** Move a connection one slot up (`dir = -1`) or down (`dir = +1`).
 *  Returns the same array reference (not a copy) when the move is a
 *  no-op — first row moving up, last row moving down, or the id isn't
 *  in the list — so callers can cheaply skip the `update()` write.
 *  Used by the Manage Connections page's reorder arrows. */
export function moveConnection(
  list: SavedConnection[],
  id: string,
  dir: -1 | 1,
): SavedConnection[] {
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return list;
  const target = idx + dir;
  if (target < 0 || target >= list.length) return list;
  const out = [...list];
  [out[idx], out[target]] = [out[target], out[idx]];
  return out;
}

/** Find by id. Returns `undefined` when the id isn't present. */
export function findConnectionById(
  list: SavedConnection[],
  id: string,
): SavedConnection | undefined {
  return list.find((c) => c.id === id);
}

/** Filter to entries matching a `(kind, host, port)` triplet. Used
 *  by the address-bar resolver + the dialog's "drafts for this
 *  host" autocomplete. Port `null` = match any port on the host. */
export function matchConnectionsForHost(
  list: SavedConnection[],
  kind: ConnectionKind,
  host: string,
  port: number | null,
): SavedConnection[] {
  const wantHost = host.toLowerCase();
  return list.filter((c) => {
    if (c.kind !== kind) return false;
    if (c.host.toLowerCase() !== wantHost) return false;
    if (port == null) return true;
    return c.port === port;
  });
}

// `findExistingConnection` / `connIdentity` were removed in 0.2.309
// when synthetic ids (`smb-<ts>`, UUIDs) were replaced by URL-form
// ids (`user@host:port`). With URL identity, dedup falls out of
// upsert-by-id: two saves with the same routing produce the same
// id, and `addOrUpdateConnection` replaces in place. No separate
// dedup pass needed.
