// Persisted connection drafts (SFTP + FTP). Kept in localStorage so
// users don't re-type host / user / port on every reconnect; passwords
// and key passphrases are NEVER persisted — those are prompted at
// connect time. Extracted from `pages/ConnectionsPage.tsx` so the
// 0.2.264 `RemoteConnectDialog` (and the address-bar resolver) can
// share the same shapes / storage keys.

const SFTP_STORAGE_KEY = "skiff-files.connections.v1";
const FTP_STORAGE_KEY = "skiff-files.connections.ftp.v1";
const SMB_STORAGE_KEY = "skiff-files.connections.smb.v1";

/** SFTP / SSH saved config. Mirrors what ConnectionsPage's New
 *  Connection form collects. Private-key passphrase + password live
 *  only in memory and at the OS keychain layer in later phases. */
export interface SftpDraft {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  authMode: "password" | "privateKey" | "agent";
  privateKeyPath?: string;
}

/** Plain-FTP saved config. Anonymous defaults match the Rust-side
 *  `FtpConfig` (`user="anonymous"`, `password="anonymous@"`). Real
 *  passwords aren't persisted — the dialog asks for one at connect
 *  time when `user !== "anonymous"`. */
export interface FtpDraft {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
}

/** SMB / Samba saved config (Phase 3c, 0.2.265). `share` is required
 *  — SMB connections bind a single share at connect time. `domain`
 *  is empty for home / NAS shares; corporate AD setups need it set
 *  to the AD domain. Passwords are never persisted. */
export interface SmbDraft {
  id: string;
  label: string;
  host: string;
  port: number;
  share: string;
  user: string;
  domain: string;
}

function loadJson<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function saveJson<T>(key: string, list: T[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode / quota — silently drop */
  }
}

export const loadSftpDrafts = (): SftpDraft[] =>
  loadJson<SftpDraft>(SFTP_STORAGE_KEY);
export const saveSftpDrafts = (drafts: SftpDraft[]): void =>
  saveJson(SFTP_STORAGE_KEY, drafts);
export const loadFtpDrafts = (): FtpDraft[] =>
  loadJson<FtpDraft>(FTP_STORAGE_KEY);
export const saveFtpDrafts = (drafts: FtpDraft[]): void =>
  saveJson(FTP_STORAGE_KEY, drafts);
/** Loads SMB drafts with on-read migration. The same storage key was
 *  previously written by ConnectionsPage's older `{ server, share, user }`
 *  shape (no port/host/domain); reading that into the canonical
 *  `{ host, port, ... }` shape would leave `host` undefined and crash
 *  `matchesHost` in the address-bar resolver. Fill missing fields with
 *  reasonable defaults so both code paths coexist with whatever
 *  localStorage already holds. Drafts that lack any usable host are
 *  dropped — they're unrecoverable. */
export const loadSmbDrafts = (): SmbDraft[] => {
  // Cast through `unknown` because the persisted shape predates the
  // current type — `loadJson<SmbDraft>` would type-coerce but not
  // guarantee field presence.
  const raw = loadJson<Record<string, unknown>>(SMB_STORAGE_KEY);
  return raw
    .map((d) => ({
      id: typeof d.id === "string" ? d.id : `smb-${Date.now()}-${Math.random()}`,
      label: typeof d.label === "string" ? d.label : "",
      host:
        typeof d.host === "string"
          ? d.host
          : typeof d.server === "string"
            ? d.server
            : "",
      port: typeof d.port === "number" ? d.port : 445,
      share: typeof d.share === "string" ? d.share : "",
      user: typeof d.user === "string" ? d.user : "",
      domain: typeof d.domain === "string" ? d.domain : "",
    }))
    .filter((d) => d.host !== "");
};
export const saveSmbDrafts = (drafts: SmbDraft[]): void =>
  saveJson(SMB_STORAGE_KEY, drafts);

/** Case-insensitive host match. Port match is optional — when the
 *  caller doesn't provide a port (raw `ftp://host` typing), every
 *  port on the same host counts; when they do, only that port.
 *
 *  Defensive: a draft persisted by an older code path may have
 *  arrived with `host` undefined (different schema on the same
 *  storage key). Drop it from matches rather than crashing the
 *  whole React tree on `.toLowerCase()` of undefined. `loadSmbDrafts`
 *  now filters these out on read, but the guard stays as a
 *  belt-and-braces — other draft sources (ftp/sftp) write through
 *  loadJson without migration. */
function matchesHost(
  draftHost: string,
  draftPort: number,
  host: string,
  port: number | null,
): boolean {
  if (!draftHost || !host) return false;
  if (draftHost.toLowerCase() !== host.toLowerCase()) return false;
  if (port == null) return true;
  return draftPort === port;
}

export function matchSftpDraftsForHost(
  drafts: SftpDraft[],
  host: string,
  port: number | null,
): SftpDraft[] {
  return drafts.filter((d) => matchesHost(d.host, d.port, host, port));
}

export function matchFtpDraftsForHost(
  drafts: FtpDraft[],
  host: string,
  port: number | null,
): FtpDraft[] {
  return drafts.filter((d) => matchesHost(d.host, d.port, host, port));
}

export function matchSmbDraftsForHost(
  drafts: SmbDraft[],
  host: string,
  port: number | null,
): SmbDraft[] {
  return drafts.filter((d) => matchesHost(d.host, d.port, host, port));
}
