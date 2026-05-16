// Unified filesystem client. Components that don't care which backend a
// path lives on call these wrappers; the dispatch on `sftp://` vs local
// happens here. Entry paths returned from remote calls are re-formatted
// back into address-bar form so the next navigation routes through the
// same backend without the caller having to remember.
//
// ============================================================
// TODO(consolidate-routing-on-backend): MIGRATION TARGET
// ============================================================
// Today the frontend owns the kind-dispatch for every fs verb
// (stat, listDir, mkdir, rename, createEmptyFile, hashSha256,
// dirSummary, removeOrTrashMany, permanentlyDeleteMany, …).
// Each function below parses a URL, picks a Rust command, and
// hands off. Bugs from this turn that all traced to one missed
// `kind === "smb"` arm somewhere in this file:
//
//   - mkdir routed only sftp → SMB New Folder no-op
//   - createEmptyFile routed only local → SMB New File no-op
//   - removeOrTrashMany / permanentlyDeleteMany routed only
//     sftp → SMB trash threw `CanonicalizePath`
//   - rename routed only sftp → cross-conn SMB rename would
//     silently fall through
//   - hashSha256 / dirSummary likewise
//   - Sidebar.tsx ALSO had a scheme picker (`kind === "ftp"
//     ? "ftp" : "sftp"`) that defaulted SMB to sftp — same
//     class of bug in a non-client.ts site.
//
// Better shape: ONE Tauri command per verb, accepts the full
// URL (`smb://<uuid>/path`, `sftp://…`, local), parses + picks
// the connection on the Rust side via `resolve_backend`. The
// frontend then has zero routing logic and adding a new
// backend means editing one Rust enum + one resolver match,
// not ~10 ternaries scattered across JS.
//
// Execution plan when this lands:
//   1. Rust: extend `resolve_backend` (already exists in
//      `commands.rs`) to return a closure-like dispatcher
//      that exposes every verb. OR add `fs_*_any` Tauri
//      commands (`fs_stat_any`, `fs_mkdir_any`, etc.) that
//      internally `match` on URL prefix.
//   2. JS: collapse these wrappers to one-liners calling the
//      `*_any` commands. Delete `conn_*` direct exports from
//      `api/conn.ts` where they're only re-bundled here.
//   3. Drop the per-kind `ListItemText.secondary` ternaries
//      in Sidebar / RemoteConnectDialog and the scheme
//      pickers; pass URL through to the same routing entry.
//   4. Run the regression suite (`*.test.tsx` added this
//      session captures the bugs that drove this TODO).
//
// Until then: every new file-op verb MUST handle all three
// remote kinds (sftp, ftp, smb) explicitly in this file. The
// `isConnectionBacked` helper below is the type-safe narrow
// for the connection-backed case — prefer it over hand-rolled
// `kind === "sftp" || ...` checks.
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

export type RemoteKind = Extract<Backend, { kind: "sftp" | "ftp" | "smb" }>["kind"];

interface DispatchSpec<T> {
  local: (path: string) => Promise<T>;
  remote?: (id: string, remotePath: string, kind: RemoteKind) => Promise<T>;
  unsupportedRemote?: (kind: RemoteKind) => Error;
}

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
  const loc = parseLocation(path);
  if (loc.backend.kind !== "local") {
    const id = loc.backend.connectionId;
    const kind = loc.backend.kind;
    const list = await connListDir(id, loc.remotePath, options);
    return list.map((e) => reshapeRemote(e, id, kind));
  }
  return fsListDir(path, options);
}

/** Backend-agnostic stat. */
export async function stat(path: string): Promise<Entry> {
  const loc = parseLocation(path);
  if (loc.backend.kind !== "local") {
    const id = loc.backend.connectionId;
    return reshapeRemote(await connStat(id, loc.remotePath), id, loc.backend.kind);
  }
  return fsStat(path);
}

/** Backend-agnostic text preview. */
export async function readText(path: string): Promise<string> {
  const loc = parseLocation(path);
  if (loc.backend.kind !== "local") {
    return connReadText(loc.backend.connectionId, loc.remotePath);
  }
  return fsReadText(path);
}

/** Backend-agnostic base64 read. */
export async function readBase64(path: string): Promise<string> {
  const loc = parseLocation(path);
  if (loc.backend.kind !== "local") {
    return connReadBase64(loc.backend.connectionId, loc.remotePath);
  }
  return fsReadBase64(path);
}

/** Backend-agnostic streaming SHA-256 hash. Routes to
 *  `fs_hash_sha256` for local paths and `conn_hash_sha256` for
 *  remotes — both stream chunked so multi-GB files don't blow up
 *  memory.
 *
 *  Only the SFTP backend has a streaming hash endpoint today; FTP
 *  and SMB don't, so the caller is expected to gate this behind a
 *  protocol check at the call site. Falling back to the local path
 *  would silently hash the wrong bytes (literal `smb://uuid/...`
 *  as an OS path). */
export async function hashSha256(path: string): Promise<string> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    return connHashSha256(loc.backend.connectionId, loc.remotePath);
  }
  if (loc.backend.kind === "ftp" || loc.backend.kind === "smb") {
    throw new Error(
      `hashSha256 not yet supported for ${loc.backend.kind} connections`,
    );
  }
  return fsHashSha256(path);
}

/** Backend-agnostic recursive directory summary. */
export async function dirSummary(path: string): Promise<DirSummary> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    return connDirSummary(loc.backend.connectionId, loc.remotePath);
  }
  if (loc.backend.kind === "ftp" || loc.backend.kind === "smb") {
    // Conservative MVP: skip the recursive size scan on FTP/SMB.
    // Returning zeros mirrors what the UI shows for an empty dir;
    // the Properties dialog reads this and just displays the
    // size column as "—". Better than silently treating the URL
    // as a local path and getting a CanonicalizePath error.
    return { entries: 0, totalSize: 0, truncated: false };
  }
  return fsDirSummary(path);
}

/** Backend-agnostic mkdir (recursive). Routes SFTP / FTP / SMB
 *  through `conn_mkdir` (which dispatches by connection kind in
 *  Rust) and everything else through the local `fs_mkdir`. */
export async function mkdir(path: string): Promise<void> {
  const loc = parseLocation(path);
  if (
    loc.backend.kind === "sftp" ||
    loc.backend.kind === "ftp" ||
    loc.backend.kind === "smb"
  ) {
    return connMkdir(loc.backend.connectionId, loc.remotePath);
  }
  return fsMkdir(path);
}

/** Backend-agnostic empty-file create — used by the New File dialog.
 *  Routes SFTP / FTP / SMB through `conn_create_empty_file` (Rust
 *  dispatches by connection kind via Connection::write_*); local
 *  paths go through `fs_create_empty_file`. Without this, the
 *  dialog calls `fs_create_empty_file("smb://uuid/...")` and gets
 *  a CanonicalizePath error that silently fails (no try/catch in
 *  the caller). */
export async function createEmptyFile(path: string): Promise<void> {
  const loc = parseLocation(path);
  if (
    loc.backend.kind === "sftp" ||
    loc.backend.kind === "ftp" ||
    loc.backend.kind === "smb"
  ) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("conn_create_empty_file", {
      id: loc.backend.connectionId,
      path: loc.remotePath,
    });
  }
  const { fsCreateEmptyFile } = await import("./fs");
  return fsCreateEmptyFile(path);
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
    fromLoc.backend.kind === "sftp" ||
    fromLoc.backend.kind === "ftp" ||
    fromLoc.backend.kind === "smb"
  ) {
    // Same-kind check already passed above; assert toLoc matches for
    // the TS narrowing and as a defense against the parseLocation
    // contract drifting.
    if (
      toLoc.backend.kind !== "sftp" &&
      toLoc.backend.kind !== "ftp" &&
      toLoc.backend.kind !== "smb"
    ) {
      throw new Error("rename across backends is not supported");
    }
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

/** Window CustomEvent fired by [[startSync]] the moment a Skiffsync
 *  job has been queued in Rust. Decouples the dispatch path from the
 *  drawer so we don't need a `sync:started` Tauri event.
 *
 *  Payload: `{ jobId: string; src: string; dest: string }`. */
export const SYNC_QUEUED_EVENT = "skiff:sync-queued";

export interface SyncQueuedDetail {
  jobId: string;
  src: string;
  dest: string;
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
  const jobId =
    isRemote(src) || isRemote(dest)
      ? await syncStartCross(src, dest, options)
      : await syncStartLocal(src, dest, options);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SYNC_QUEUED_EVENT, {
        detail: { jobId, src, dest },
      }),
    );
  }
  return jobId;
}

/** True iff this backend kind has a server-side connection in the
 *  registry that handles its own delete (SFTP / FTP / SMB). The Local
 *  variant doesn't — local paths go through the OS trash / fs_remove.
 *  Centralizing the test stops every per-path branch from forgetting
 *  to include a backend (the SMB-trash bug from before the fix). */
function isConnectionBacked(
  loc: ReturnType<typeof parseLocation>,
): loc is ReturnType<typeof parseLocation> & {
  backend: { kind: "sftp" | "ftp" | "smb"; connectionId: string };
} {
  return (
    loc.backend.kind === "sftp" ||
    loc.backend.kind === "ftp" ||
    loc.backend.kind === "smb"
  );
}

/** Multi-path delete that picks the right backend per path. Local
 *  paths go to the OS trash; remote paths permanently delete (no
 *  server-side trash exists on SFTP / FTP / SMB). The caller should
 *  confirm before this is invoked when remote paths are present,
 *  since they're permanent.
 *
 *  Earlier shape only routed SFTP through `conn_remove` and bucketed
 *  FTP + SMB into the local pile, which then hit `fs_trash_many` and
 *  tried to canonicalize `smb://<uuid>/...` as a local path. The
 *  error surfaced as `CanonicalizePath { original: "...smb://..." }`
 *  in the UI snackbar. */
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
      const { fsRemove } = await import("./fs");
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
