// Swap raw connection UUIDs in a remote URL / error message for the
// friendly registry label so users see `admin@192.168.1.1:445/G`
// instead of `ba47a8e7-cc66-4af6-8d61-093b9b7b2fae`. Keeps the rest
// of the path intact so callers can use the output verbatim.
//
// Used by the unreachable-folder placeholder and the error toast in
// `Browser.tsx` — both surfaces were rendering the raw UUID, which
// is the worst possible UX when something goes wrong (the user can
// see "something broke", but not *which connection* broke).
//
// Pure helper — accepts a `connectionId → label` map so the callsite
// owns the registry refresh cadence. Empty map = pass-through.

import { parseLocation } from "./location";

const SCHEMES = ["sftp://", "ftp://", "smb://"] as const;

/** Replace `<scheme>://<uuid>` in `path` with `<scheme>://<label>`
 *  when a label is known. The remote path tail is preserved as-is. */
export function humanizeRemoteUrl(
  path: string,
  labels: Map<string, string>,
): string {
  if (!path) return path;
  const loc = parseLocation(path);
  if (loc.backend.kind === "local") return path;
  const label = labels.get(loc.backend.connectionId);
  if (!label) return path; // unknown connection id — keep raw form
  return `${loc.backend.kind}://${label}${loc.remotePath}`;
}

/** Walk a free-form string (e.g. an error message) and substitute
 *  any UUID-shaped substring that matches a known connection id
 *  for its friendly label. Anchored on UUIDv4 shape so we don't
 *  accidentally rewrite hex content that happens to share a prefix
 *  with a connection id. */
export function humanizeMessage(
  msg: string,
  labels: Map<string, string>,
): string {
  if (!msg) return msg;
  // UUIDv4: 8-4-4-4-12 hex, case-insensitive. Global match so every
  // occurrence in the message gets swapped (errors sometimes echo
  // the id more than once).
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  return msg.replace(uuid, (match) => {
    const label = labels.get(match);
    return label ?? match;
  });
}

/** Re-export the scheme list so callers (the placeholder, the
 *  error toast) can compose their own substitutions if they need
 *  to. Most should stick with the helpers above. */
export const REMOTE_SCHEMES = SCHEMES;
