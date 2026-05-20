// Canonical connection-identity URL builder. Every saved connection's
// `id` (and the matching registry slot key + internal URL prefix)
// uses this form — `<scheme>://<user>@<host>:<port>` — so the
// internal URL is identical to the OS-native URL the file manager
// hands off. No more synthetic `smb-1779235589933` ids, no more
// `humanize` translation layer.
//
// Why the format works as a `connectionId` segment in the wire form
// `<scheme>://<id>/<path>`: `parseLocation` extracts everything
// between `<scheme>://` and the next `/` as the id. `user@host:port`
// has no `/`, so the wire form `smb://admin@192.168.1.1:445/G/file`
// round-trips cleanly through `parseLocation` (id =
// `admin@192.168.1.1:445`, remotePath = `/G/file`).
//
// The `user` segment is rendered unencoded — usernames in SFTP / FTP /
// SMB are constrained to a small ASCII subset by the underlying
// protocols (RFC 4253 for SSH, RFC 959 for FTP, MS-NLMP for SMB) and
// the dialog rejects whitespace at input time. If a future codepath
// accepts an unconstrained user string we'd need to URL-encode here.

import type { ConnectionKind } from "../state/connectionStore";

/** Default port per protocol. Matches the connect-dialog's port
 *  pre-fill and the Rust-side `SmbConfig::default_port` constants.
 *  Used to elide the `:port` suffix from the canonical URL when the
 *  port is the default — keeps the id (and the user-visible URL)
 *  tidy. */
const DEFAULT_PORTS: Record<ConnectionKind, number> = {
  sftp: 22,
  ftp: 21,
  smb: 445,
};

export interface ConnectionIdentity {
  kind: ConnectionKind;
  host: string;
  port: number;
  user: string;
}

/** Build the canonical URL identity for a connection. The returned
 *  string is suitable for use as `SavedConnection.id`, as the
 *  registry slot key, and as the `<id>` segment in `<scheme>://<id>/<path>`
 *  internal URLs.
 *
 *  Shape:
 *    sftp://syle@nas.local:22       → `syle@nas.local:22`
 *    sftp://syle@nas.local          → `syle@nas.local` (default port elided)
 *    smb://admin@192.168.1.1:445    → `admin@192.168.1.1:445`
 *    smb://192.168.1.1:445          → `guest@192.168.1.1:445` (empty user → `guest`)
 *    ftp://ftp.kernel.org           → `anonymous@ftp.kernel.org`
 *
 *  Empty `user` defaults to `guest` (SMB convention) for SMB and
 *  `anonymous` for FTP — both match what the connect dialog auto-
 *  fills, so saved entries stay consistent. SFTP empty user is left
 *  as `user` (the dialog requires it, so this is defensive only).
 *
 *  The `<scheme>://` prefix is NOT included — the returned string is
 *  the *id segment* only. Callers that want the full URL prepend the
 *  scheme themselves (every callsite already knows the kind). */
export function connectionId(identity: ConnectionIdentity): string {
  const { kind, host, port, user } = identity;
  const u = user || (kind === "ftp" ? "anonymous" : kind === "smb" ? "guest" : "user");
  const portSuffix = port === DEFAULT_PORTS[kind] ? "" : `:${port}`;
  return `${u}@${host}${portSuffix}`;
}

/** Build the full canonical URL — `<scheme>://<id>`. Convenience
 *  for callsites that want the user-visible form (sidebar labels,
 *  error messages, the dialog title). */
export function connectionUrl(identity: ConnectionIdentity): string {
  return `${identity.kind}://${connectionId(identity)}`;
}

/** Parse an id segment back to its components. Returns `null` when
 *  the input doesn't conform to the `user@host[:port]` shape — the
 *  caller falls back to treating the id as opaque (e.g. for legacy
 *  pre-migration entries still keyed by the old `smb-<timestamp>`
 *  form before the loader has had a chance to rewrite them).
 *
 *  The `kind` argument supplies the default port when the id omits
 *  one. Without `kind` we can't tell whether `host` means port 22,
 *  21, or 445, so the parse signature requires it. */
export function parseConnectionId(
  id: string,
  kind: ConnectionKind,
): ConnectionIdentity | null {
  const at = id.indexOf("@");
  if (at < 0) return null;
  const user = id.slice(0, at);
  const rest = id.slice(at + 1);
  const colon = rest.lastIndexOf(":");
  // No colon → default port for the scheme.
  if (colon < 0) {
    if (!rest) return null;
    return { kind, host: rest, port: DEFAULT_PORTS[kind], user };
  }
  const host = rest.slice(0, colon);
  const portStr = rest.slice(colon + 1);
  const port = Number(portStr);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return { kind, host, port, user };
}
