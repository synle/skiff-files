// Translate an internal `<scheme>://<uuid>/<path>` URL into the
// OS-native form a system handler can resolve. Internal connection
// UUIDs (e.g. `e78756b4-cc3b-402a-…`) live only inside Skiff Files
// — they're routing keys for the in-memory connection registry,
// not real hostnames. When we hand a path to the OS (open-with-
// default-app, reveal-in-OS, drag-out), we MUST translate to the
// native form first, otherwise macOS / Windows / Linux try to
// resolve the UUID as a hostname and surface a confusing
// "server not found" error.
//
// Native URL grammars:
//   - SMB  → `smb://[user@]host[:port]/<share>/<path>` — supported
//     by macOS Finder, GNOME Files, KDE Dolphin, Windows Explorer.
//   - SFTP → no consistent OS handler; macOS reroutes through
//     Finder's "Connect to server" but doesn't support arbitrary
//     file open. Returns null so callers can show an error toast
//     instead of silently failing.
//   - FTP  → same as SFTP. Most OSes deprecated their FTP
//     handlers. Returns null.

import type { SavedConnection } from "../state/connectionStore";
import { parseLocation } from "./location";

export interface NativeUrlResult {
  /** The translated URL the OS handler accepts, or `null` when
   *  the scheme has no first-class OS handler (SFTP / FTP). */
  url: string | null;
  /** Human-readable hint surfaced when `url` is null so callers
   *  can show "SFTP doesn't have a native open handler — drag
   *  the file out instead" etc. */
  reason?: string;
}

/** Translate an internal `<scheme>://<uuid>/<path>` URL into the
 *  OS-native form. Returns `{ url: null, reason }` when the scheme
 *  has no native handler; the local-path case passes through. */
export function toNativeRemoteUrl(
  path: string,
  connections: SavedConnection[],
): NativeUrlResult {
  if (!path) return { url: "" };
  const loc = parseLocation(path);
  // Local paths pass through unchanged.
  if (loc.backend.kind === "local") return { url: path };

  // From here on we know `loc.backend` is one of the remote
  // variants. TypeScript's discriminated-union narrowing carries
  // through the rest of the function.
  const remote = loc.backend;
  const saved = connections.find((c) => c.id === remote.connectionId);
  if (!saved) {
    return {
      url: null,
      reason: `Unknown connection (id: ${remote.connectionId})`,
    };
  }

  if (remote.kind === "smb") {
    // SMB has the cleanest native handler — macOS Finder, Windows
    // Explorer, and Linux file managers all understand
    // `smb://[user@]host[:port]/<share>/<rel>` directly.
    //
    // Two cases for the remote path:
    //   - Bound-share mode (saved.share is non-empty): the URL we
    //     route internally is `smb://uuid/<rel-within-share>` —
    //     we need to inject the share back.
    //   - Share-agnostic mode (saved.share is empty): the URL is
    //     already `smb://uuid/<share>/<rel>` — pass through.
    const userPart = saved.user ? `${encodeURIComponent(saved.user)}@` : "";
    // Port suffix only when non-default so URLs stay tidy. SMB
    // default port is 445.
    const portPart = saved.port && saved.port !== 445 ? `:${saved.port}` : "";
    const rel = loc.remotePath.replace(/^\/+/, "");
    const sharePrefix = saved.share ? `${encodeURIComponent(saved.share)}/` : "";
    return {
      url: `smb://${userPart}${saved.host}${portPart}/${sharePrefix}${rel}`,
    };
  }

  if (remote.kind === "sftp") {
    return {
      url: null,
      reason:
        "Open-with-default isn't supported on SFTP. Use Skiff Files to view the file, or drag it out to copy locally first.",
    };
  }

  if (remote.kind === "ftp") {
    return {
      url: null,
      reason:
        "Open-with-default isn't supported on FTP. Drag the file out to copy it locally first.",
    };
  }

  return { url: null, reason: `Unsupported scheme` };
}
