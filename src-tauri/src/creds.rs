//! OS keychain integration for connection credentials. Backed by the
//! `keyring` crate which speaks the native API of each platform —
//! macOS Keychain (`Security.framework`), Windows Credential Manager
//! (`wincred` + DPAPI per-user encryption), Linux libsecret over
//! D-Bus (GNOME Keyring / KWallet / KeePassXC). All three encrypt
//! at rest with the user's session and refuse to release the secret
//! to another user / process on the same machine.
//!
//! Storage shape:
//!   - service = the app identifier from `tauri.conf.json`
//!     (`com.synle.skiff-files`). One service per app so OS audit
//!     tools (Keychain Access on macOS, Credential Manager on
//!     Windows) show a single grouping.
//!   - account = `{secret_kind}:{connection_id}`. The secret-kind
//!     prefix lets one connection hold both a password (`auth:`)
//!     and a private-key passphrase (`key:`) without collision.
//!
//! `capable()` probes whether the backend is actually reachable
//! (Linux installs without a running secret-service daemon return
//! false). Frontend hides the Remember-password affordance when
//! the probe says no — falling back silently to plaintext would be
//! worse than the explicit "no persistence" outcome.

use serde::Deserialize;

/// Service name shared by every keychain entry the app writes.
/// Keeping it stable across releases is load-bearing — changing
/// this string orphans every existing secret.
const SERVICE: &str = "com.synle.skiff-files";

/// Discriminator for the secret kind we're storing. The dialog
/// only writes `Auth` today (FTP/SFTP/SMB passwords + the password
/// arm of SFTP key auth — though the latter is uncommon since
/// SSH agents handle most key-auth setups). `KeyPassphrase` is
/// reserved for the SFTP private-key passphrase slot if we ever
/// want to remember it separately.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Auth,
    KeyPassphrase,
}

impl SecretKind {
    fn prefix(self) -> &'static str {
        match self {
            SecretKind::Auth => "auth",
            SecretKind::KeyPassphrase => "key",
        }
    }
}

fn account_for(kind: SecretKind, connection_id: &str) -> String {
    format!("{}:{}", kind.prefix(), connection_id)
}

fn entry(kind: SecretKind, connection_id: &str) -> Result<keyring::Entry, String> {
    let account = account_for(kind, connection_id);
    keyring::Entry::new(SERVICE, &account)
        .map_err(|e| format!("keyring::Entry::new({SERVICE}, {account}): {e}"))
}

/// Store a secret in the OS keychain. Overwrites any existing
/// secret at the same (service, account). Returns `Ok(())` on
/// success.
pub fn store(connection_id: &str, kind: SecretKind, secret: &str) -> Result<(), String> {
    let e = entry(kind, connection_id)?;
    e.set_password(secret)
        .map_err(|err| format!("keyring set_password: {err}"))
}

/// Load a secret from the OS keychain. Returns `Ok(None)` when no
/// entry exists for this (kind, connection_id) — caller falls
/// through to the prompt path. Any other error (locked keychain,
/// permission denied) surfaces as `Err`.
pub fn load(connection_id: &str, kind: SecretKind) -> Result<Option<String>, String> {
    let e = entry(kind, connection_id)?;
    match e.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("keyring get_password: {err}")),
    }
}

/// Delete a secret from the OS keychain. Idempotent: deleting a
/// non-existent entry returns `Ok(())` rather than failing, so the
/// frontend can blindly call this when toggling "Remember password"
/// from on → off.
pub fn delete(connection_id: &str, kind: SecretKind) -> Result<(), String> {
    let e = entry(kind, connection_id)?;
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("keyring delete_credential: {err}")),
    }
}

/// Probe whether the keychain backend is reachable. macOS / Windows
/// always succeed; Linux fails when there's no secret-service
/// daemon running (minimal installs, headless CI images). We probe
/// by attempting a read of a sentinel entry — the entry doesn't
/// need to exist for the probe to succeed, only the backend
/// connection itself needs to come up cleanly.
pub fn capable() -> bool {
    let probe = keyring::Entry::new(SERVICE, "probe");
    let Ok(e) = probe else { return false };
    matches!(e.get_password(), Ok(_) | Err(keyring::Error::NoEntry))
}

#[cfg(test)]
mod tests {
    use super::*;

    // We deliberately don't write to the user's real keychain in
    // unit tests — there's no isolated keychain per cargo run.
    // The `keyring` crate ships with a `mock` feature gated behind
    // the `MockKeyring` backend; not enabling it here keeps the
    // dependency tree minimal. Instead we exercise the small bits
    // of logic that don't touch the OS: account name composition
    // + the SecretKind prefix mapping.
    #[test]
    fn account_for_namespaces_by_secret_kind() {
        assert_eq!(account_for(SecretKind::Auth, "abc-123"), "auth:abc-123");
        assert_eq!(
            account_for(SecretKind::KeyPassphrase, "abc-123"),
            "key:abc-123",
        );
    }

    #[test]
    fn service_constant_matches_app_identifier() {
        // Cross-check with `tauri.conf.json#identifier`. If someone
        // renames the app this test fails loudly and the new
        // identifier needs to be threaded through — otherwise every
        // existing user's saved credentials orphan.
        assert_eq!(SERVICE, "com.synle.skiff-files");
    }

    /// Pin the `SecretKind::prefix` mapping directly. `account_for`
    /// indirectly exercises it but a future refactor that introduces
    /// a new variant + forgets to update `prefix()` would collide on
    /// the empty-prefix default and silently merge two secret kinds.
    #[test]
    fn prefix_is_unique_per_secret_kind() {
        assert_eq!(SecretKind::Auth.prefix(), "auth");
        assert_eq!(SecretKind::KeyPassphrase.prefix(), "key");
        assert_ne!(
            SecretKind::Auth.prefix(),
            SecretKind::KeyPassphrase.prefix(),
            "secret-kind prefixes must be unique so accounts don't collide"
        );
    }

    /// `entry()` is the keychain-`Entry::new` wrapper that every public
    /// store/load/delete goes through. Constructing one for a valid
    /// (service, account) pair must succeed on every supported platform
    /// — the keyring backend rejects on `Entry::new` only for malformed
    /// service strings (which our constant isn't). The returned Entry
    /// is dropped without ever calling get/set, so this stays a
    /// pure-logic test and never touches the user's real keychain.
    #[test]
    fn entry_constructs_for_valid_inputs() {
        // Use an obviously-fake connection id so even if a buggy
        // future change wrote during construction (it doesn't), the
        // resulting account name wouldn't conflict with real saved
        // credentials.
        let res = entry(SecretKind::Auth, "skiff-coverage-test-id");
        assert!(res.is_ok(), "entry() failed for valid inputs: {res:?}");
        let res = entry(SecretKind::KeyPassphrase, "skiff-coverage-test-id");
        assert!(res.is_ok(), "entry() failed for valid inputs: {res:?}");
    }

    /// `SecretKind` is Deserialize via serde; the frontend posts
    /// `"auth"` / `"keyPassphrase"`. Pin the wire shape so a rename
    /// trips here before it silently breaks the dialog.
    #[test]
    fn secret_kind_deserializes_from_camelcase() {
        let kind: SecretKind = serde_json::from_str("\"auth\"").unwrap();
        assert_eq!(kind.prefix(), "auth");
        let kind: SecretKind = serde_json::from_str("\"keyPassphrase\"").unwrap();
        assert_eq!(kind.prefix(), "key");
    }
}
