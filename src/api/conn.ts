// Typed wrappers around the `conn_*` Tauri commands. Mirrors `api/fs.ts`
// but for remote (registry-backed) connections.
import { invoke } from "@tauri-apps/api/core";
import type { DirSummary, Entry, ListOptions } from "./fs";

/** Mirror of `crate::fs::registry::ConnectionKind`. */
export type ConnectionKind = "sftp" | "ftp" | "smb";

/** Mirror of `crate::fs::registry::ConnectionInfo`. */
export interface ConnectionInfo {
  id: string;
  kind: ConnectionKind;
  label: string;
}

/** Mirror of `crate::fs::ssh_config::SshConfigHost`. */
export interface SshConfigHost {
  name: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
  identityFile: string | null;
}

/** Importable hosts from `~/.ssh/config`. Empty when the file doesn't
 *  exist or contains no parseable entries. */
export const sshConfigHosts = (): Promise<SshConfigHost[]> =>
  invoke<SshConfigHost[]>("ssh_config_hosts");

/** Mirror of `crate::fs::sftp::SftpConfig`. At least one of
 *  `password`, `privateKeyPath`, or `useAgent` must be set — the
 *  backend rejects an empty auth payload. When `useAgent` is true,
 *  the engine tries every identity in `$SSH_AUTH_SOCK` first and
 *  falls back to the other methods only if the agent is empty. */
export interface SftpConfig {
  host: string;
  port?: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  useAgent?: boolean;
}

export const connCreateSftp = (config: SftpConfig): Promise<string> =>
  invoke<string>("conn_create_sftp", { config });

/** Mirror of `crate::fs::ftp::FtpConfig`. Phase 3a (0.2.246) ships
 *  plain FTP only — FTPS toggle lands later. `user` / `password`
 *  default to the anonymous-FTP convention so the form can leave
 *  them blank for public mirrors. */
export interface FtpConfig {
  host: string;
  port?: number;
  user?: string;
  password?: string;
}

export const connCreateFtp = (config: FtpConfig): Promise<string> =>
  invoke<string>("conn_create_ftp", { config });

/** Mirror of `crate::fs::smb::SmbConfig` (0.2.265 Phase 3c).
 *  Per-share connection — opening a second share on the same host
 *  is a second `connCreateSmb` call. `domain` is optional; leave
 *  empty for home / NAS shares. */
export interface SmbConfig {
  host: string;
  port?: number;
  share: string;
  user: string;
  password: string;
  domain?: string;
}

export const connCreateSmb = (config: SmbConfig): Promise<string> =>
  invoke<string>("conn_create_smb", { config });

export const connDisconnect = (id: string): Promise<void> =>
  invoke<void>("conn_disconnect", { id });

export const connList = (): Promise<ConnectionInfo[]> =>
  invoke<ConnectionInfo[]>("conn_list");

export const connListDir = (
  id: string,
  path: string,
  options?: ListOptions,
): Promise<Entry[]> =>
  invoke<Entry[]>("conn_list_dir", { id, path, options });

export const connStat = (id: string, path: string): Promise<Entry> =>
  invoke<Entry>("conn_stat", { id, path });

export const connReadText = (id: string, path: string): Promise<string> =>
  invoke<string>("conn_read_text", { id, path });

export const connReadBase64 = (id: string, path: string): Promise<string> =>
  invoke<string>("conn_read_base64", { id, path });

export const connDirSummary = (
  id: string,
  path: string,
): Promise<DirSummary> => invoke<DirSummary>("conn_dir_summary", { id, path });

/** Create a directory on a remote (recursive, idempotent). */
export const connMkdir = (id: string, path: string): Promise<void> =>
  invoke<void>("conn_mkdir", { id, path });

/** Rename / same-FS move on a remote. */
export const connRename = (
  id: string,
  from: string,
  to: string,
): Promise<void> => invoke<void>("conn_rename", { id, from, to });

/** Recursive remove on a remote. Permanent — there's no server-side
 *  trash; the frontend should confirm before invoking. */
export const connRemove = (id: string, path: string): Promise<void> =>
  invoke<void>("conn_remove", { id, path });

/** TOFU known-hosts entry: `[hostKeyId, sha256BaseFingerprint]` pairs.
 *  hostKeyId is the canonical `<host>:<port>` form the engine uses
 *  internally. */
export type KnownHostEntry = [string, string];

/** List every host the registry has a stored fingerprint for. */
export const connKnownHostsList = (): Promise<KnownHostEntry[]> =>
  invoke<KnownHostEntry[]>("conn_known_hosts_list");

/** Streaming SHA-256 hash of a remote file. Mirrors `fsHashSha256`
 *  but reads via the SFTP backend so the file's bytes never leave
 *  the server's machine in plaintext. */
export const connHashSha256 = (id: string, path: string): Promise<string> =>
  invoke<string>("conn_hash_sha256", { id, path });

/** Forget a single `host:port` entry. The next connect to it will
 *  re-trust on first use. Idempotent. */
export const connKnownHostsRemove = (keyId: string): Promise<void> =>
  invoke<void>("conn_known_hosts_remove", { keyId });
