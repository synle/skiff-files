// Unified filesystem client. Components that don't care which backend a
// path lives on call these wrappers; the dispatch on `sftp://` vs `ftp://`
// vs `smb://` vs local happens here. Entry paths returned from remote
// calls are re-formatted back into address-bar form so the next
// navigation routes through the same backend without the caller having
// to remember.
//
// ============================================================
// Routing model (0.2.271 consolidation)
// ============================================================
// Every fs-verb wrapper below goes through ONE helper:
// `dispatchByLocation`. The helper owns the URL → backend
// decision; each verb supplies a `local` handler and an optional
// `remote` handler. If a verb omits `remote`, the helper throws a
// crisp "verb not supported on <kind>" error rather than silently
// treating the URL as a local path (which used to surface as a
// confusing `CanonicalizePath { original: "smb://..." }`).
//
// This shape replaced the old pattern of every verb hand-rolling
// its own `if (kind === "sftp" || kind === "ftp" || kind === "smb")`
// branch — a pattern that caused the 0.2.270 bug cluster (mkdir
// missed SMB, removeOrTrashMany missed FTP/SMB, rename missed SMB,
// createEmptyFile missed SMB). Now adding a new backend means
// editing ONE place (parseLocation + the `BackendKind` union),
// and verifying that each verb either declares it as a `remote`
// (full SFTP/FTP/SMB support) or rejects it (e.g. hashSha256 only
// runs on SFTP).
//
// Future stretch goal — out of scope for this PR: a parallel set
// of `fs_*_any` Tauri commands that accept the full URL and route
// in Rust via `resolve_backend`. That would let the frontend
// collapse to one-line `invoke()`s. The dispatcher introduced here
// is the front-half of that refactor; the back-half is incremental
// and doesn't block the user-visible fix.
// ============================================================
import {
  fsCreateEmptyFile,
  fsDirSummary,
  fsHashSha256,
  fsListDir,
  fsMkdir,
  fsReadBase64,
  fsReadText,
  fsRemove,
  fsRename,
  fsStat,
  fsTrashMany,
  type DirSummary,
  type Entry,
  type ListOptions,
} from "./fs";
import {
  connDirSummary,
  connHashSha256,
  connListDir,
  connMkdir,
  connReadBase64,
  connReadText,
  connRemove,
  connRename,
  connStat,
} from "./conn";
import {
  formatFtp,
  formatSftp,
  formatSmb,
  isRemote,
  parseLocation,
  type Backend,
  type Location,
} from "../util/location";
import {
  syncStartCross,
  syncStartLocal,
  type JobOptions,
} from "./sync";

/** Type alias for the connection-backed remote kinds — every kind that
 *  has a registry entry + scheme prefix. Adding a new backend means
 *  extending this union (and updating `parseLocation`); the rest of
 *  this file enforces the new kind at compile time via the dispatcher's
 *  `remote` callback signature. */
export type RemoteKind = Extract<Backend, { kind: "sftp" | "ftp" | "smb" }>["kind"];

/** Dispatch spec for a single fs verb. `local` is the local-path
 *  handler. `remote` is the unified remote handler — when present, it
 *  receives the connection id + share/path + kind so the body can call
 *  the appropriate `conn_*` Tauri command. When absent, the dispatcher
 *  throws a typed error if a remote URL lands. Use `unsupportedRemote`
 *  to customize the error message per verb. */
interface DispatchSpec<T> {
  local: (path: string) => Promise<T>;
  remote?: (id: string, remotePath: string, kind: RemoteKind) => Promise<T>;
  /** Build the error message thrown when a remote URL is passed to a
   *  verb that didn't declare `remote`. Defaults to a generic "not
   *  supported" message; override for verbs with partial support
   *  (e.g. hashSha256 → SFTP-only). */
  unsupportedRemote?: (kind: RemoteKind) => Error;
}

/** Central URL → handler dispatch. Every wrapper in this file goes
 *  through here so the routing decision lives in exactly one place.
 *
 *  Exported for direct use by callers that need the dispatch primitive
 *  outside this file (e.g. tests that exercise the parsing decision in
 *  isolation). */
export async function dispatchByLocation<T>(
  path: string,
  spec: DispatchSpec<T>,
): Promise<T> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "local") {
    return spec.local(path);
  }
  if (!spec.remote) {
    const kind = loc.backend.kind;
    const err =
      spec.unsupportedRemote?.(kind) ??
      new Error(`operation not supported on ${kind} connections`);
    throw err;
  }
  return spec.remote(
    loc.backend.connectionId,
    loc.remotePath,
    loc.backend.kind,
  );
}

/** Re-shape a remote Entry so its `path` field is the full
 *  `<scheme>://<id>/...` form rather than the bare server-side
 *  path. Required because the rest of the app consumes
 *  Entry.path as the destination of "open this entry". */
function reshapeRemote(
  e: Entry,
  connectionId: string,
  scheme: RemoteKind,
): Entry {
  const formatter =
    scheme === "ftp" ? formatFtp : scheme === "smb" ? formatSmb : formatSftp;
  return { ...e, path: formatter(connectionId, e.path) };
}

/** Backend-agnostic directory listing. */
export async function listDir(
  path: string,
  options?: ListOptions,
): Promise<Entry[]> {
  return dispatchByLocation(path, {
    local: (p) => fsListDir(p, options),
    remote: async (id, remotePath, kind) => {
      const list = await connListDir(id, remotePath, options);
      return list.map((e) => reshapeRemote(e, id, kind));
    },
  });
}

/** Backend-agnostic stat. */
export async function stat(path: string): Promise<Entry> {
  return dispatchByLocation(path, {
    local: fsStat,
    remote: async (id, remotePath, kind) =>
      reshapeRemote(await connStat(id, remotePath), id, kind),
  });
}

/** Backend-agnostic text preview. */
export async function readText(path: string): Promise<string> {
  return dispatchByLocation(path, {
    local: fsReadText,
    remote: (id, remotePath) => connReadText(id, remotePath),
  });
}

/** Backend-agnostic base64 read. */
export async function readBase64(path: string): Promise<string> {
  return dispatchByLocation(path, {
    local: fsReadBase64,
    remote: (id, remotePath) => connReadBase64(id, remotePath),
  });
}

/** Backend-agnostic streaming SHA-256 hash. Only SFTP has a streaming
 *  hash endpoint today; FTP and SMB don't. The dispatcher throws a
 *  per-kind error so the caller can show a useful message instead of
 *  silently hashing the wrong bytes (the literal `smb://uuid/...`
 *  string as an OS path). */
export async function hashSha256(path: string): Promise<string> {
  return dispatchByLocation(path, {
    local: fsHashSha256,
    // Only SFTP exposes a streaming hash today. `remote` handles the
    // SFTP case and re-throws the "not supported" error for ftp/smb so
    // the caller still gets a clean message.
    remote: async (id, remotePath, kind) => {
      if (kind === "sftp") return connHashSha256(id, remotePath);
      throw new Error(`hashSha256 not yet supported for ${kind} connections`);
    },
  });
}

/** Backend-agnostic recursive directory summary. SFTP gets the real
 *  recursive scan; FTP / SMB return zeros (conservative MVP — the
 *  Properties dialog reads this and shows `—` for size). */
export async function dirSummary(path: string): Promise<DirSummary> {
  return dispatchByLocation(path, {
    local: fsDirSummary,
    remote: async (id, remotePath, kind) => {
      if (kind === "sftp") return connDirSummary(id, remotePath);
      // Conservative MVP: skip the recursive size scan on FTP/SMB.
      // Returning zeros mirrors what the UI shows for an empty dir;
      // the Properties dialog reads this and just displays the
      // size column as "—". Better than silently treating the URL
      // as a local path and getting a CanonicalizePath error.
      return { entries: 0, totalSize: 0, truncated: false };
    },
  });
}

/** Backend-agnostic mkdir (recursive). Routes SFTP / FTP / SMB
 *  through `conn_mkdir` (which dispatches by connection kind in
 *  Rust) and local paths through `fs_mkdir`. */
export async function mkdir(path: string): Promise<void> {
  return dispatchByLocation(path, {
    local: fsMkdir,
    remote: (id, remotePath) => connMkdir(id, remotePath),
  });
}

/** Backend-agnostic empty-file create — used by the New File dialog.
 *  Routes SFTP / FTP / SMB through `conn_create_empty_file` (Rust
 *  dispatches by connection kind via Connection::write_*); local
 *  paths go through `fs_create_empty_file`. */
export async function createEmptyFile(path: string): Promise<void> {
  return dispatchByLocation(path, {
    local: fsCreateEmptyFile,
    remote: async (id, remotePath) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<void>("conn_create_empty_file", {
        id,
        path: remotePath,
      });
    },
  });
}

/** Backend-agnostic rename / same-FS move. Both `from` and `to` must
 *  live on the same backend; cross-backend rename should go through a
 *  sync_start_cross job (copy + remove). The frontend currently calls
 *  this from the F2 rename dialog where both paths share the same
 *  parent, so the same-backend assumption holds trivially. */
export async function rename(from: string, to: string): Promise<void> {
  const fromLoc = parseLocation(from);
  const toLoc = parseLocation(to);
  if (fromLoc.backend.kind !== toLoc.backend.kind) {
    throw new Error("rename across backends is not supported");
  }
  if (
    fromLoc.backend.kind !== "local" &&
    toLoc.backend.kind !== "local"
  ) {
    if (fromLoc.backend.connectionId !== toLoc.backend.connectionId) {
      throw new Error(
        `rename across different ${fromLoc.backend.kind} connections`,
      );
    }
    return connRename(
      fromLoc.backend.connectionId,
      fromLoc.remotePath,
      toLoc.remotePath,
    );
  }
  return fsRename(from, to);
}

/** Backend-agnostic sync starter. Pure local-to-local goes through
 *  `sync_start_local` (kernel-accelerated copy path); anything that
 *  involves a remote endpoint routes through `sync_start_cross`. The
 *  caller doesn't need to care which is used. */
export async function startSync(
  src: string,
  dest: string,
  options?: JobOptions,
): Promise<string> {
  if (isRemote(src) || isRemote(dest)) {
    return syncStartCross(src, dest, options);
  }
  return syncStartLocal(src, dest, options);
}

/** True iff this location targets a backend whose deletes are
 *  permanent (no OS trash). The Local variant has trash; SFTP / FTP /
 *  SMB don't. Centralizing the test stops every per-path branch from
 *  forgetting to include a backend (the SMB-trash bug from 0.2.270). */
function isConnectionBacked(
  loc: Location,
): loc is Location & {
  backend: { kind: RemoteKind; connectionId: string };
} {
  return loc.backend.kind !== "local";
}

/** Multi-path delete that picks the right backend per path. Local
 *  paths go to the OS trash; remote paths permanently delete (no
 *  server-side trash exists on SFTP / FTP / SMB). The caller should
 *  confirm before this is invoked when remote paths are present,
 *  since they're permanent. */
export async function removeOrTrashMany(paths: string[]): Promise<void> {
  // Group locals together for one batched fs_trash_many; dispatch
  // remotes per-path through their connection.
  const local: string[] = [];
  const remote: { id: string; remotePath: string }[] = [];
  for (const p of paths) {
    const loc = parseLocation(p);
    if (isConnectionBacked(loc)) {
      remote.push({
        id: loc.backend.connectionId,
        remotePath: loc.remotePath,
      });
    } else {
      local.push(p);
    }
  }
  if (local.length) await fsTrashMany(local);
  for (const r of remote) await connRemove(r.id, r.remotePath);
}

/** Permanently delete a multi-path selection. Bypasses OS trash. Local
 *  paths use `fs_remove` (recursive); remote paths route through
 *  `conn_remove`. The caller should confirm with destructive wording
 *  before invoking — there's no recovery path here. */
export async function permanentlyDeleteMany(paths: string[]): Promise<void> {
  for (const p of paths) {
    const loc = parseLocation(p);
    if (isConnectionBacked(loc)) {
      await connRemove(loc.backend.connectionId, loc.remotePath);
    } else {
      await fsRemove(p);
    }
  }
}

/** Restore the most recently trashed entries matching the given paths
 *  via the OS trash API. Linux + Windows use the `trash` crate's
 *  os_limited::restore_all; macOS surfaces an actionable error since
 *  the crate doesn't expose programmatic restore on that platform.
 *  Returns the number of entries actually restored. */
export async function fsTrashRestore(paths: string[]): Promise<number> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number>("fs_trash_restore", { paths });
}
