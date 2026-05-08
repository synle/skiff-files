// Typed wrappers around the `conn_*` Tauri commands. Mirrors `api/fs.ts`
// but for remote (registry-backed) connections.
import { invoke } from "@tauri-apps/api/core";
import type { DirSummary, Entry, ListOptions } from "./fs";

/** Mirror of `crate::fs::registry::ConnectionKind`. */
export type ConnectionKind = "sftp";

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

/** Mirror of `crate::fs::sftp::SftpConfig`. Auth is exactly one of
 *  `password` or `privateKeyPath` — the backend rejects empty/both. */
export interface SftpConfig {
  host: string;
  port?: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export const connCreateSftp = (config: SftpConfig): Promise<string> =>
  invoke<string>("conn_create_sftp", { config });

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

/** Forget a single `host:port` entry. The next connect to it will
 *  re-trust on first use. Idempotent. */
export const connKnownHostsRemove = (keyId: string): Promise<void> =>
  invoke<void>("conn_known_hosts_remove", { keyId });
