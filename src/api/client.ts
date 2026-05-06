// Unified filesystem client. Components that don't care which backend a
// path lives on call these wrappers; the dispatch on `sftp://` vs local
// happens here. Entry paths returned from remote calls are re-formatted
// back into address-bar form so the next navigation routes through the
// same backend without the caller having to remember.
import {
  fsListDir,
  fsMkdir,
  fsStat,
  fsReadText,
  fsReadBase64,
  fsDirSummary,
  fsTrashMany,
  type DirSummary,
  type Entry,
  type ListOptions,
} from "./fs";
import {
  connDirSummary,
  connListDir,
  connMkdir,
  connReadBase64,
  connReadText,
  connRemove,
  connStat,
} from "./conn";
import { formatSftp, isRemote, parseLocation } from "../util/location";
import {
  syncStartCross,
  syncStartLocal,
  type JobOptions,
} from "./sync";

/** Re-shape a remote Entry so its `path` field is the full sftp:// form
 *  rather than the bare server-side path. Required because the rest of
 *  the app consumes Entry.path as the destination of "open this entry". */
function reshapeRemote(e: Entry, connectionId: string): Entry {
  return { ...e, path: formatSftp(connectionId, e.path) };
}

/** Backend-agnostic directory listing. */
export async function listDir(
  path: string,
  options?: ListOptions,
): Promise<Entry[]> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    const id = loc.backend.connectionId;
    const list = await connListDir(id, loc.remotePath, options);
    return list.map((e) => reshapeRemote(e, id));
  }
  return fsListDir(path, options);
}

/** Backend-agnostic stat. */
export async function stat(path: string): Promise<Entry> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    const id = loc.backend.connectionId;
    return reshapeRemote(await connStat(id, loc.remotePath), id);
  }
  return fsStat(path);
}

/** Backend-agnostic text preview. */
export async function readText(path: string): Promise<string> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    return connReadText(loc.backend.connectionId, loc.remotePath);
  }
  return fsReadText(path);
}

/** Backend-agnostic base64 read. */
export async function readBase64(path: string): Promise<string> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    return connReadBase64(loc.backend.connectionId, loc.remotePath);
  }
  return fsReadBase64(path);
}

/** Backend-agnostic recursive directory summary. */
export async function dirSummary(path: string): Promise<DirSummary> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    return connDirSummary(loc.backend.connectionId, loc.remotePath);
  }
  return fsDirSummary(path);
}

/** Backend-agnostic mkdir (recursive). */
export async function mkdir(path: string): Promise<void> {
  const loc = parseLocation(path);
  if (loc.backend.kind === "sftp") {
    return connMkdir(loc.backend.connectionId, loc.remotePath);
  }
  return fsMkdir(path);
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

/** Multi-path delete that picks the right backend per path. Local
 *  paths go to the OS trash; remote paths permanently delete (no
 *  server-side trash exists). The caller should confirm before this is
 *  invoked when remote paths are present, since they're permanent. */
export async function removeOrTrashMany(paths: string[]): Promise<void> {
  // Group locals together for one batched fs_trash_many; dispatch
  // remotes per-path through their connection.
  const local: string[] = [];
  const remote: { id: string; remotePath: string }[] = [];
  for (const p of paths) {
    const loc = parseLocation(p);
    if (loc.backend.kind === "sftp") {
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
