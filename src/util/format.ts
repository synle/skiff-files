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

/** Format a unix-second mtime according to the user's `dateFormat`
 *  setting. Pure helper — accepts the format string so callers can
 *  invoke it from a useMemo without re-reading the settings store
 *  per-row. */
export function formatMtimeAs(
  unixSeconds: number | null | undefined,
  format: "locale" | "iso" | "short" | "relative",
): string {
  if (unixSeconds == null) return "—";
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  switch (format) {
    case "iso":
      return d.toISOString().replace("T", " ").slice(0, 19);
    case "short": {
      const pad = (n: number) => n.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    case "relative":
      return formatMtimeRelative(unixSeconds);
    case "locale":
    default:
      return d.toLocaleString();
  }
}

/**
 * Human-readable "N seconds/minutes/hours/days ago" form. Used as a
 * tooltip on the mtime column so users can read recency at a glance
 * without parsing a locale timestamp. Future-dated mtimes (clock skew)
 * fall through to "in the future".
 */
export function formatMtimeRelative(
  unixSeconds: number | null | undefined,
): string {
  if (unixSeconds == null) return "—";
  const nowSec = Date.now() / 1000;
  const diff = nowSec - unixSeconds;
  if (!Number.isFinite(diff)) return "—";
  if (diff < 0) return "in the future";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365)
    return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
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

  // Remote (sftp:// / ftp:// / smb://) — first segment is the
  // connection id; the rest are POSIX-shaped within the remote
  // root. Without an explicit case here, ftp:// and smb:// paths
  // fall through to the POSIX branch below which produces nonsense
  // segments (`/smb:` / `/smb:/<uuid>` instead of `smb://<uuid>/`),
  // and `parentPath` then walks the user past the share root and
  // off into the filesystem — exactly the "up-button past root"
  // bug from image #74-#76.
  const REMOTE_SCHEMES: { prefix: string; scheme: string }[] = [
    { prefix: "sftp://", scheme: "sftp" },
    { prefix: "ftp://", scheme: "ftp" },
    { prefix: "smb://", scheme: "smb" },
  ];
  for (const { prefix, scheme } of REMOTE_SCHEMES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const id = slash < 0 ? rest : rest.slice(0, slash);
    const remote = slash < 0 ? "/" : rest.slice(slash) || "/";
    const out: { label: string; path: string }[] = [];
    out.push({ label: id, path: `${scheme}://${id}/` });
    const parts = remote.split("/").filter(Boolean);
    let acc = "";
    for (const p of parts) {
      acc += `/${p}`;
      out.push({ label: p, path: `${scheme}://${id}${acc}` });
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
    // Always include the leading "/" segment — `parentPath` and
    // back-navigation rely on it. The PathBar component hides it
    // visually so the breadcrumb reads cleaner.
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
