// Resolve a raw address-bar URL into a canonical
// `<scheme>://<connection-id>/<path>` form, auto-creating an ephemeral
// connection when the user typed a hostname instead of a registered id.
//
// Why this exists (0.2.263): the registry assigns UUIDv4 ids to every
// saved SFTP / FTP connection, and `parseLocation` treats the part
// after `ftp://` as that id. So typing `ftp://ftp.example.com/pub`
// would look up a connection with id "ftp.example.com" — which never
// matches — and surface "no such connection" downstream. Bridging the
// two forms ("UUID is a registered connection, anything host-shaped
// auto-creates one") makes the address bar work the way users from
// Finder / Cyberduck / FileZilla expect.
//
// Scope: FTP only (anonymous default — no auth prompt needed). SFTP
// keeps the saved-connection-first flow because anonymous SFTP isn't
// a thing and a password prompt dialog is a separate feature.

import { connCreateFtp, connList } from "../api/conn";

const FTP_PREFIX = "ftp://";
/** UUIDv4 with the hyphens (the registry's id format). Anything that
 *  matches this is assumed to be a registered connection id and is
 *  passed through untouched. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HostishUrl {
  user: string;
  password: string;
  host: string;
  port: number;
}

/** Parse the `[user[:password]@]host[:port]` chunk between the scheme
 *  prefix and the first path-slash. Defaults match the Rust
 *  `conn_create_ftp` server-side defaults (anonymous / port 21). */
function parseHostish(raw: string): HostishUrl | null {
  if (!raw) return null;
  let rest = raw;
  let user = "";
  let password = "";
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    const userPart = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const colon = userPart.indexOf(":");
    if (colon >= 0) {
      user = decodeURIComponent(userPart.slice(0, colon));
      password = decodeURIComponent(userPart.slice(colon + 1));
    } else {
      user = decodeURIComponent(userPart);
    }
  }
  if (!rest) return null;
  let host = rest;
  let port = 21;
  // IPv6 hosts come wrapped in `[..]:port` — strip the brackets and
  // skip the colon scan inside them.
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close < 0) return null;
    host = rest.slice(1, close);
    const portTail = rest.slice(close + 1);
    if (portTail.startsWith(":")) {
      const n = Number(portTail.slice(1));
      if (!Number.isFinite(n) || n <= 0 || n > 65535) return null;
      port = n;
    }
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon > 0) {
      const after = rest.slice(colon + 1);
      const n = Number(after);
      if (Number.isFinite(n) && n > 0 && n <= 65535 && /^\d+$/.test(after)) {
        host = rest.slice(0, colon);
        port = n;
      }
    }
  }
  if (!host) return null;
  return { user, password, host, port };
}

/** Look up an existing FTP connection whose label matches the same
 *  `[user@]host:port` shape `conn_create_ftp` would have produced.
 *  Lets repeated address-bar typing of the same host reuse one TCP
 *  control connection instead of stacking up duplicates. */
function findExistingFtp(
  conns: { id: string; kind: string; label: string }[],
  parsed: HostishUrl,
): string | null {
  const user = parsed.user || "anonymous";
  const label =
    user === "anonymous"
      ? `${parsed.host}:${parsed.port}`
      : `${user}@${parsed.host}:${parsed.port}`;
  const hit = conns.find((c) => c.kind === "ftp" && c.label === label);
  return hit ? hit.id : null;
}

/** Canonicalize a possibly-hostish URL into a UUID-form URL the rest
 *  of the dispatch pipeline already handles. Returns the input
 *  unchanged when it's already canonical (or when no auto-resolve
 *  applies — e.g. local paths, sftp://).
 *
 *  Throws on connection failure so the caller can surface a real
 *  error to the user instead of silently navigating to a dead URL. */
export async function resolveRemoteUrl(path: string): Promise<string> {
  if (!path.startsWith(FTP_PREFIX)) return path;

  const after = path.slice(FTP_PREFIX.length);
  const slash = after.indexOf("/");
  const idOrHost = slash >= 0 ? after.slice(0, slash) : after;
  const rest = slash >= 0 ? after.slice(slash) : "/";

  // Already canonical — pass through.
  if (UUID_RE.test(idOrHost)) return path;

  const parsed = parseHostish(idOrHost);
  if (!parsed) return path;

  // Try to reuse an existing connection with the same auth shape
  // before opening a new TCP socket. The registry's labels follow
  // the same `[user@]host:port` convention `conn_create_ftp` uses,
  // so a string match is a reliable equality check.
  try {
    const conns = await connList();
    const existingId = findExistingFtp(conns, parsed);
    if (existingId) return `${FTP_PREFIX}${existingId}${rest}`;
  } catch {
    // connList isn't a blocker — fall through to create.
  }

  const newId = await connCreateFtp({
    host: parsed.host,
    port: parsed.port,
    user: parsed.user || undefined,
    password: parsed.password || undefined,
  });
  // Bug 7 (0.2.279) — notify the Sidebar HOSTS / BrowserTabs / PathBar
  // friendly-label map so anonymous-FTP URLs typed in the address bar
  // surface immediately, without a navigate-away-and-back kick.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("skiff:connections-changed"));
  }
  return `${FTP_PREFIX}${newId}${rest}`;
}

/** Parsed shape for the address-bar resolver. `null` means the URL
 *  is already canonical (UUID form) or isn't a remote URL we want
 *  the dialog to handle. */
export interface ParsedRemoteUrl {
  scheme: "sftp" | "ftp" | "smb";
  host: string;
  port: number | null;
  user?: string;
  remotePath: string;
}

/** Split a typed remote URL into `RemoteConnectDialog` inputs.
 *
 *  Returns `null` when the id-or-host segment is UUID-shaped (the
 *  URL is already canonical and PathBar should navigate directly) —
 *  or when the URL isn't `sftp://` / `ftp://` / `smb://`. */
export function parseRemoteUrl(path: string): ParsedRemoteUrl | null {
  let scheme: "sftp" | "ftp" | "smb";
  let prefix: string;
  if (path.startsWith("ftp://")) {
    scheme = "ftp";
    prefix = "ftp://";
  } else if (path.startsWith("sftp://")) {
    scheme = "sftp";
    prefix = "sftp://";
  } else if (path.startsWith("smb://")) {
    scheme = "smb";
    prefix = "smb://";
  } else {
    return null;
  }
  const after = path.slice(prefix.length);
  const slash = after.indexOf("/");
  const idOrHost = slash >= 0 ? after.slice(0, slash) : after;
  const remotePath = slash >= 0 ? after.slice(slash) : "/";
  // Already canonical — caller skips the dialog.
  if (UUID_RE.test(idOrHost)) return null;
  const parsed = parseHostish(idOrHost);
  if (!parsed) return null;
  // For host-form URLs we keep `port` as-typed (null when omitted) so
  // the matcher can fuzzy-match against any saved port on the same
  // host. The dialog supplies the scheme-default when it opens.
  const hadExplicitPort = /:\d+(\/|$)/.test(idOrHost);
  return {
    scheme,
    host: parsed.host,
    port: hadExplicitPort ? parsed.port : null,
    user: parsed.user || undefined,
    remotePath,
  };
}

// Test-only export. Vitest uses `vi.importActual` so module-internal
// helpers stay private at runtime but the test can still target the
// parser directly.
export const __testing__ = { parseHostish, findExistingFtp };
