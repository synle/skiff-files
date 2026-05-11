// A "location" is the address bar's value: a string that may target the
// local filesystem or a remote backend. The Browser, PreviewPane, and
// path utilities all consume locations as plain strings; this module is
// the single place that splits them into backend + path.
//
// Phase 2b shipped SFTP + local. Phase 3a (0.2.246) adds plain FTP via
// `ftp://<id>/<path>` so the same parse/format helpers cover every
// remote backend uniformly. SMB joins next with `smb://` once we have
// the docker harness.

export type Backend =
  // FYI – SMB joined in 0.2.265 alongside SFTP/FTP. SMB connections
  // bind a single share at create time, so the connectionId encodes
  // (host, port, user, share) and the remotePath is share-relative.
  | { kind: "smb"; connectionId: string }
//
// (the existing variants follow — kept as one union for grep-ability)
//
  | { kind: "local" }
  | { kind: "sftp"; connectionId: string }
  | { kind: "ftp"; connectionId: string };

export interface Location {
  backend: Backend;
  /** Path within the backend. Always absolute. Local paths come through
   *  unchanged; remote paths drop the `<scheme>://<id>` prefix. */
  remotePath: string;
}

const SFTP_PREFIX = "sftp://";
const FTP_PREFIX = "ftp://";
const SMB_PREFIX = "smb://";

/**
 * Parse a location string. A leading `sftp://` / `ftp://` switches to
 * the matching remote backend; everything else is treated as a local
 * path so the existing call sites that pass `/Users/...` or
 * `C:\Users\...` keep working.
 *
 * Examples:
 *   parseLocation("/Users/syle")        → { local, "/Users/syle" }
 *   parseLocation("sftp://abc-123/")    → { sftp:abc-123, "/" }
 *   parseLocation("sftp://abc/foo/bar") → { sftp:abc, "/foo/bar" }
 *   parseLocation("ftp://m1/pub")       → { ftp:m1, "/pub" }
 */
export function parseLocation(path: string): Location {
  if (path.startsWith(SFTP_PREFIX)) {
    const { id, remote } = splitRemote(path, SFTP_PREFIX);
    return {
      backend: { kind: "sftp", connectionId: id },
      remotePath: remote,
    };
  }
  if (path.startsWith(FTP_PREFIX)) {
    const { id, remote } = splitRemote(path, FTP_PREFIX);
    return {
      backend: { kind: "ftp", connectionId: id },
      remotePath: remote,
    };
  }
  if (path.startsWith(SMB_PREFIX)) {
    const { id, remote } = splitRemote(path, SMB_PREFIX);
    return {
      backend: { kind: "smb", connectionId: id },
      remotePath: remote,
    };
  }
  return { backend: { kind: "local" }, remotePath: path };
}

function splitRemote(
  path: string,
  prefix: string,
): { id: string; remote: string } {
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  const id = slash < 0 ? rest : rest.slice(0, slash);
  const remote = slash < 0 ? "/" : rest.slice(slash) || "/";
  return { id, remote };
}

/** Build the address-bar form of an SFTP location. The remote path is
 *  forced to start with `/` so we don't get `sftp://idfoo` for
 *  malformed callers. */
export function formatSftp(connectionId: string, remotePath: string): string {
  const norm = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return `${SFTP_PREFIX}${connectionId}${norm}`;
}

/** Build the address-bar form of an FTP location. Same normalization
 *  rule as `formatSftp`. */
export function formatFtp(connectionId: string, remotePath: string): string {
  const norm = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return `${FTP_PREFIX}${connectionId}${norm}`;
}

/** Build the address-bar form of an SMB location. */
export function formatSmb(connectionId: string, remotePath: string): string {
  const norm = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return `${SMB_PREFIX}${connectionId}${norm}`;
}

/** Serialize any location back to the address-bar form. */
export function formatLocation(loc: Location): string {
  if (loc.backend.kind === "sftp") {
    return formatSftp(loc.backend.connectionId, loc.remotePath);
  }
  if (loc.backend.kind === "ftp") {
    return formatFtp(loc.backend.connectionId, loc.remotePath);
  }
  if (loc.backend.kind === "smb") {
    return formatSmb(loc.backend.connectionId, loc.remotePath);
  }
  return loc.remotePath;
}

/** True iff the location targets a remote backend. Convenience for
 *  toggling UI affordances (e.g. disabling tilde-expansion). SMB
 *  was added as a real backend in 0.2.265 (smb2 crate, pure-Rust);
 *  same uniform remote semantics as SFTP and FTP from this point
 *  forward. */
export function isRemote(path: string): boolean {
  return (
    path.startsWith(SFTP_PREFIX) ||
    path.startsWith(FTP_PREFIX) ||
    path.startsWith(SMB_PREFIX)
  );
}
