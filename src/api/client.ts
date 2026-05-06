// Unified filesystem client. Components that don't care which backend a
// path lives on call these wrappers; the dispatch on `sftp://` vs local
// happens here. Entry paths returned from remote calls are re-formatted
// back into address-bar form so the next navigation routes through the
// same backend without the caller having to remember.
import {
  fsListDir,
  fsStat,
  fsReadText,
  fsReadBase64,
  fsDirSummary,
  type DirSummary,
  type Entry,
  type ListOptions,
} from "./fs";
import {
  connListDir,
  connStat,
  connReadText,
  connReadBase64,
  connDirSummary,
} from "./conn";
import { formatSftp, parseLocation } from "../util/location";

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
