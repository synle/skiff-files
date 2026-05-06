// A "location" is the address bar's value: a string that may target the
// local filesystem or a remote backend. The Browser, PreviewPane, and
// path utilities all consume locations as plain strings; this module is
// the single place that splits them into backend + path.
//
// Phase 2b only knows about SFTP and local; FTP / SMB join here in
// Phase 3 as additional schemes.

export type Backend =
  | { kind: "local" }
  | { kind: "sftp"; connectionId: string };

export interface Location {
  backend: Backend;
  /** Path within the backend. Always absolute. Local paths come through
   *  unchanged; remote paths drop the `sftp://<id>` prefix. */
  remotePath: string;
}

const SFTP_PREFIX = "sftp://";

/**
 * Parse a location string. A leading `sftp://` switches to the SFTP
 * backend; everything else is treated as a local path so the existing
 * call sites that pass `/Users/...` or `C:\Users\...` keep working.
 *
 * Examples:
 *   parseLocation("/Users/syle")        → { local, "/Users/syle" }
 *   parseLocation("sftp://abc-123/")    → { sftp:abc-123, "/" }
 *   parseLocation("sftp://abc/foo/bar") → { sftp:abc, "/foo/bar" }
 */
export function parseLocation(path: string): Location {
  if (path.startsWith(SFTP_PREFIX)) {
    const rest = path.slice(SFTP_PREFIX.length);
    const slash = rest.indexOf("/");
    const id = slash < 0 ? rest : rest.slice(0, slash);
    const remote = slash < 0 ? "/" : rest.slice(slash) || "/";
    return {
      backend: { kind: "sftp", connectionId: id },
      remotePath: remote,
    };
  }
  return { backend: { kind: "local" }, remotePath: path };
}

/** Build the address-bar form of an SFTP location. The remote path is
 *  forced to start with `/` so we don't get `sftp://idfoo` for
 *  malformed callers. */
export function formatSftp(connectionId: string, remotePath: string): string {
  const norm = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return `${SFTP_PREFIX}${connectionId}${norm}`;
}

/** Serialize any location back to the address-bar form. */
export function formatLocation(loc: Location): string {
  if (loc.backend.kind === "sftp") {
    return formatSftp(loc.backend.connectionId, loc.remotePath);
  }
  return loc.remotePath;
}

/** True iff the location targets a remote backend. Convenience for
 *  toggling UI affordances (e.g. disabling tilde-expansion). */
export function isRemote(path: string): boolean {
  return path.startsWith(SFTP_PREFIX);
}
