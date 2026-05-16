// Compact a path for tight sidebar slots. Keeps the last segment in
// full, abbreviates every middle segment to its first character, and
// — on POSIX paths inside the user's home — replaces the home prefix
// with `~`.
//
// Examples:
//   /Users/syle/git/file-explorer/src-tauri/icons/android
//     home=/Users/syle → ~/g/f/s/i/android
//   c:/Users/Syle/xxx/yyy/zzz
//     → c:/U/S/x/y/zzz
//   sftp://abc/home/user/foo/bar
//     → sftp://abc/h/u/f/bar
//
// The full path is preserved verbatim in tooltips + the "Show all
// recent" dialog; this helper is only for the cramped sidebar row.

import { isRemote, parseLocation } from "./location";

/** Abbreviate a single path's middle segments. Last segment stays
 *  in full; middle segments collapse to their first character. */
function shortenSegments(segments: string[]): string[] {
  if (segments.length <= 1) return segments;
  const out: string[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    // Codepoint-aware first-char so non-ASCII filenames don't get
    // mangled (e.g. emoji folder names).
    const first = [...seg][0] ?? "";
    out.push(first);
  }
  out.push(segments[segments.length - 1]);
  return out;
}

/** Strip a leading drive-letter token from a Windows path (e.g.
 *  `c:` or `C:`). Returns the matched prefix + the remaining path. */
function splitWindowsDrive(path: string): { drive: string; rest: string } {
  // Drive prefix shapes we see in the wild: `C:`, `C:/`, `C:\`.
  const m = /^([A-Za-z]):[\\/]?/.exec(path);
  if (!m) return { drive: "", rest: path };
  return { drive: `${m[1].toLowerCase()}:`, rest: path.slice(m[0].length) };
}

/** True iff `home` is a non-empty prefix of `path` at a `/` boundary. */
function isUnderHome(path: string, home: string): boolean {
  if (!home) return false;
  if (path === home) return true;
  return path.startsWith(home.endsWith("/") ? home : `${home}/`);
}

/** Compact a path to fit a narrow sidebar slot. `home` is the user's
 *  resolved home dir; passing an empty string skips the `~` rewrite. */
export function shortPath(path: string, home: string): string {
  if (!path) return path;

  // Remote paths keep the `<scheme>://<id>` prefix and abbreviate
  // the remote-side path only. Empty/single-segment remote paths
  // (e.g. `sftp://abc/`) stay unchanged so the user can still tell
  // which connection they were at.
  if (isRemote(path)) {
    const loc = parseLocation(path);
    const connId =
      "connectionId" in loc.backend ? loc.backend.connectionId : "";
    const segs = loc.remotePath.split("/").filter(Boolean);
    const scheme = path.slice(0, path.indexOf("://") + 3);
    if (segs.length === 0) {
      return `${scheme}${connId}/`;
    }
    return `${scheme}${connId}/${shortenSegments(segs).join("/")}`;
  }

  // Windows: keep the drive letter intact, abbreviate the rest.
  const { drive, rest } = splitWindowsDrive(path);
  if (drive) {
    const segs = rest.replace(/\\/g, "/").split("/").filter(Boolean);
    if (segs.length === 0) return `${drive}/`;
    return `${drive}/${shortenSegments(segs).join("/")}`;
  }

  // POSIX. Replace home with `~` when applicable.
  if (isUnderHome(path, home)) {
    const tail = path === home ? "" : path.slice(home.length + 1);
    if (!tail) return "~";
    const segs = tail.split("/").filter(Boolean);
    if (segs.length === 0) return "~";
    return `~/${shortenSegments(segs).join("/")}`;
  }

  // Plain absolute path with no home match (e.g. `/etc/hosts`).
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return path;
  return `/${shortenSegments(segs).join("/")}`;
}

/** Friendly label for the backend behind a recent-path entry —
 *  used in the "Show all recent" dialog so users can tell SFTP / FTP
 *  / SMB / Local apart at a glance. */
export function pathOriginLabel(path: string): string {
  if (path.startsWith("sftp://")) return "SFTP";
  if (path.startsWith("ftp://")) return "FTP";
  if (path.startsWith("smb://")) return "SMB";
  return "Local";
}
