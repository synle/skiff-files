// Typed wrappers for the OS-keychain credential commands. The
// service / account naming is fixed by the Rust side
// (`creds.rs::account_for`); callers only see the (connection_id,
// kind) shape.
//
// `kind` discriminates between the password slot (`"auth"`) and the
// SSH private-key passphrase slot (`"key"`) so one connection can
// hold both without collision. Today the dialog only writes `auth`;
// `key` is reserved for the SFTP private-key passphrase if we ever
// want to remember it separately.

import { invoke } from "@tauri-apps/api/core";

/** Mirror of `crate::creds::SecretKind` (serde camelCase). */
export type SecretKind = "auth" | "keyPassphrase";

/** Persist a secret. Returns Err when the keychain backend can't be
 *  reached (Linux installs without a running secret-service daemon,
 *  locked macOS Keychain first-prompt). The dialog probes
 *  `credsCapable` before offering the toggle so this is rare. */
export const credsStore = (
  connectionId: string,
  kind: SecretKind,
  secret: string,
): Promise<void> =>
  invoke<void>("creds_store", { connectionId, kind, secret });

/** Load a secret. Resolves to `null` when no entry exists for this
 *  (kind, connectionId) — callers fall through to the prompt. Any
 *  other error rejects. */
export const credsLoad = (
  connectionId: string,
  kind: SecretKind,
): Promise<string | null> =>
  invoke<string | null>("creds_load", { connectionId, kind });

/** Delete a secret. Idempotent — deleting a non-existent entry
 *  resolves cleanly so the dialog can blindly call this when the
 *  Remember-password toggle flips off. */
export const credsDelete = (
  connectionId: string,
  kind: SecretKind,
): Promise<void> => invoke<void>("creds_delete", { connectionId, kind });

/** Probe whether the keychain backend is reachable. macOS / Windows
 *  always return true; Linux returns false when secret-service is
 *  not running. The dialog gates the Remember-password toggle on
 *  this so we don't silently fall back to plaintext. */
export const credsCapable = (): Promise<boolean> =>
  invoke<boolean>("creds_capable");
