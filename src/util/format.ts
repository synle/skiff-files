// Tiny formatting helpers shared by the file list, status bar, and properties
// dialog. Pure functions, no React — kept here so they can be unit-tested
// without spinning up Testing Library.

/** Human-readable byte size. Picks the largest unit where the value is < 1024. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  // < 10 → one decimal, otherwise integer. Matches Finder/Explorer.
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/**
 * Format a unix-second mtime as a locale string. Returns "—" for null/undefined
 * since we don't want to show a 1970 date when the platform couldn't read the
 * mtime.
 */
export function formatMtime(unixSeconds: number | null | undefined): string {
  if (unixSeconds == null) return "—";
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/**
 * Split a filesystem path into ancestor segments suitable for a breadcrumb.
 * Works for POSIX (`/a/b/c`), Windows (`C:\\a\\b`), and remote
 * (`sftp://<id>/a/b`) inputs.
 *
 * Returns an array of `{ label, path }` pairs where each `path` is the full
 * address-bar form up to and including that segment. Remote segments keep
 * their scheme prefix so clicking them re-navigates through the same backend.
 */
export function pathSegments(path: string): { label: string; path: string }[] {
  if (!path) return [];

  // Remote (sftp://id/a/b/c) — first segment is the connection id; the rest
  // are POSIX-shaped within the remote root.
  if (path.startsWith("sftp://")) {
    const rest = path.slice("sftp://".length);
    const slash = rest.indexOf("/");
    const id = slash < 0 ? rest : rest.slice(0, slash);
    const remote = slash < 0 ? "/" : rest.slice(slash) || "/";
    const out: { label: string; path: string }[] = [];
    out.push({ label: id, path: `sftp://${id}/` });
    const parts = remote.split("/").filter(Boolean);
    let acc = "";
    for (const p of parts) {
      acc += `/${p}`;
      out.push({ label: p, path: `sftp://${id}${acc}` });
    }
    return out;
  }

  // Detect Windows-style by leading drive letter; otherwise treat as POSIX.
  const isWin = /^[A-Za-z]:[\\/]/.test(path);
  const sep = isWin ? "\\" : "/";
  const normalized = path.replace(/[\\/]+/g, sep);
  const parts = normalized.split(sep).filter(Boolean);

  const out: { label: string; path: string }[] = [];
  if (isWin && parts.length > 0) {
    // First part is the drive (e.g. "C:")
    const drive = parts[0];
    out.push({ label: drive, path: `${drive}${sep}` });
    let acc = `${drive}${sep}`;
    for (let i = 1; i < parts.length; i++) {
      acc += parts[i] + sep;
      out.push({ label: parts[i], path: acc.replace(/\\$/, "") });
    }
  } else {
    out.push({ label: "/", path: "/" });
    let acc = "";
    for (const p of parts) {
      acc += `/${p}`;
      out.push({ label: p, path: acc });
    }
  }
  return out;
}

/** Parent of `path`. Returns the path itself for filesystem roots
 *  (including remote roots like `sftp://id/`). */
export function parentPath(path: string): string {
  if (!path) return path;
  const segs = pathSegments(path);
  if (segs.length <= 1) return path;
  return segs[segs.length - 2].path;
}
