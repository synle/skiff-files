//! TOFU (trust on first use) host-key tracking for SFTP connections.
//!
//! On first connect to a `host:port`, we record the SHA-256 fingerprint
//! of the server's public key in `app_data_dir()/known_hosts.json`.
//! Subsequent connects verify the fingerprint matches; mismatches are
//! refused with a clear error so the user knows the host changed.
//!
//! Storage format is a flat JSON map:
//! ```json
//! { "user@example.com:22": "QkE0...nopadbase64sha256...",
//!   "10.0.0.5:2222":       "Wj9p...nopadbase64sha256..." }
//! ```

use std::collections::BTreeMap;
use std::path::Path;

/// Read the known-hosts map. Missing file returns an empty map (the
/// next call will create it on first write). Parse errors propagate so
/// the caller can decide whether to ignore-and-recreate.
pub fn load(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let body =
        std::fs::read_to_string(path).map_err(|e| format!("read known_hosts: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("parse known_hosts: {e}"))
}

/// Atomic save via temp + rename. Creates the parent directory if
/// necessary so the first connect on a fresh install doesn't fail.
pub fn save(path: &Path, map: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    }
    let body = serde_json::to_string_pretty(map)
        .map_err(|e| format!("serialize known_hosts: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Outcome of checking a host key against the known-hosts file. The
/// connect path inspects this to decide whether to abort the handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckOutcome {
    /// First time seeing this host — store the fingerprint and accept.
    NewHost,
    /// Stored fingerprint matches — accept.
    Match,
    /// Stored fingerprint differs — refuse, surface the stored vs.
    /// presented fingerprints in the error so the user can investigate.
    Mismatch { stored: String, presented: String },
}

/// Pure check helper. Doesn't write. The caller decides whether to
/// persist on `NewHost` (the SFTP handler path always does).
pub fn check(
    map: &BTreeMap<String, String>,
    key_id: &str,
    presented: &str,
) -> CheckOutcome {
    match map.get(key_id) {
        None => CheckOutcome::NewHost,
        Some(stored) if stored == presented => CheckOutcome::Match,
        Some(stored) => CheckOutcome::Mismatch {
            stored: stored.clone(),
            presented: presented.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_new_host() {
        let m = BTreeMap::new();
        assert_eq!(check(&m, "h:22", "abc"), CheckOutcome::NewHost);
    }

    #[test]
    fn check_match() {
        let mut m = BTreeMap::new();
        m.insert("h:22".to_string(), "abc".to_string());
        assert_eq!(check(&m, "h:22", "abc"), CheckOutcome::Match);
    }

    #[test]
    fn check_mismatch() {
        let mut m = BTreeMap::new();
        m.insert("h:22".to_string(), "abc".to_string());
        assert_eq!(
            check(&m, "h:22", "xyz"),
            CheckOutcome::Mismatch {
                stored: "abc".into(),
                presented: "xyz".into(),
            }
        );
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempdir();
        let path = dir.join("known_hosts.json");
        let mut m = BTreeMap::new();
        m.insert("a:22".into(), "fp1".into());
        m.insert("b:2222".into(), "fp2".into());
        save(&path, &m).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, m);
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir();
        let path = dir.join("does-not-exist.json");
        assert!(load(&path).unwrap().is_empty());
    }

    fn tempdir() -> std::path::PathBuf {
        let mut d = std::env::temp_dir();
        d.push(format!(
            "skiff-known-hosts-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
