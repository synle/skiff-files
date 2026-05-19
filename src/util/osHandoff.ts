// Hand a Skiff Files path off to the OS — translating the internal
// `<scheme>://<uuid>/<path>` form into the OS-native form before the
// call. Without this translation macOS Finder / Windows Explorer /
// Linux file managers see a UUID where they expect a hostname and
// surface "server not found" toasts (the user-visible bug in image #3
// of the 0.2.305 issue: clicking a file on a saved SMB connection
// popped "There was a problem connecting to df204a67-…").
//
// Layered on top of `toNativeRemoteUrl` — that helper handles the URL
// translation, this one wires it to the actual `fs_open_with_default`
// / `fs_reveal_in_os` IPC calls and routes the "no native handler"
// reason (SFTP / FTP) into the caller's error sink.

import { fsOpenWithDefault, fsRevealInOs } from "../api/fs";
import type { SavedConnection } from "../state/connectionStore";
import { toNativeRemoteUrl } from "./nativeRemoteUrl";

/** Open `path` with the OS default application. Translates internal
 *  remote URLs to their native form first; emits the
 *  `toNativeRemoteUrl` reason through `onError` when no native handler
 *  exists (SFTP / FTP). Errors from the IPC call also route through
 *  `onError` so callers can surface them in the same toast. */
export async function osOpen(
  path: string,
  connections: SavedConnection[],
  onError?: (msg: string) => void,
): Promise<void> {
  const { url, reason } = toNativeRemoteUrl(path, connections);
  if (url == null) {
    onError?.(reason ?? "Cannot open with default app");
    return;
  }
  try {
    await fsOpenWithDefault(url);
  } catch (e) {
    onError?.(String(e));
  }
}

/** Reveal `path` in the OS file manager. Same translation contract as
 *  `osOpen` — internal `<scheme>://<uuid>` URLs get rewritten to
 *  `<scheme>://[user@]host[:port]/<share>/<rel>` before the IPC call,
 *  and SFTP / FTP routes surface the "no native handler" reason. */
export async function osReveal(
  path: string,
  connections: SavedConnection[],
  onError?: (msg: string) => void,
): Promise<void> {
  const { url, reason } = toNativeRemoteUrl(path, connections);
  if (url == null) {
    onError?.(reason ?? "Cannot reveal in OS file manager");
    return;
  }
  try {
    await fsRevealInOs(url);
  } catch (e) {
    onError?.(String(e));
  }
}
