//! macOS Full Disk Access (TCC) detection + System Settings deep-link.
//!
//! macOS gates apps from reading certain user-data folders behind the
//! TCC "Full Disk Access" privacy permission. Without FDA, attempts to
//! list a protected directory surface a `PermissionDenied`
//! (`EPERM` / errno 1) instead of normal entries — the user sees a
//! silently-empty folder from inside Skiff and has no obvious cue
//! that the OS is the one blocking it.
//!
//! Canonical FDA-gated probe paths used here:
//!   - `~/Library/Safari`
//!   - `~/Library/Mail`
//!   - `~/Library/Messages`
//!   - `~/Library/Application Support/MobileSync`
//!
//! Algorithm: try `read_dir` on each. The first `Ok` short-circuits to
//! "granted" (we proved we can read at least one TCC path). A
//! `PermissionDenied` flips a flag we use only when no probe succeeds.
//! `NotFound` / other errors are inconclusive (e.g. Mail.app never
//! opened on a fresh install) and don't move the verdict either way.
//! If no probe succeeded AND we saw at least one `PermissionDenied`,
//! return `false` — that's the only proof FDA is denied. Otherwise
//! return `true` so we don't pester users on a brand-new macOS install
//! that's never opened Safari / Mail / Messages.
//!
//! The frontend pairs the boolean with `open_full_disk_access_settings`
//! to deep-link the System Settings → Privacy & Security → Full Disk
//! Access pane via the documented
//! `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`
//! URL, so the user can grant access without hunting through panes.
//!
//! On non-macOS targets every entry point becomes a trivial pass-through:
//! `has_full_disk_access` returns `true` (no equivalent privacy gate),
//! and `open_full_disk_access_settings` rejects with an explanatory
//! error so a frontend caller that accidentally invokes it on Windows /
//! Linux fails loud instead of silently no-op'ing.

/// Probe whether the running process has Full Disk Access on macOS.
/// See module doc for the algorithm. Returns `true` on any non-macOS
/// target since the FDA permission model is macOS-specific.
#[cfg(target_os = "macos")]
pub fn has_full_disk_access() -> bool {
    use std::fs;
    use std::io::ErrorKind;
    let Some(home) = dirs::home_dir() else {
        // Without a home dir we have nothing to probe; treat as
        // granted so we don't show a false-positive prompt.
        return true;
    };
    let candidates = [
        home.join("Library").join("Safari"),
        home.join("Library").join("Mail"),
        home.join("Library").join("Messages"),
        home.join("Library")
            .join("Application Support")
            .join("MobileSync"),
    ];
    let mut saw_denied = false;
    for p in &candidates {
        match fs::read_dir(p) {
            Ok(_) => return true,
            Err(e) if e.kind() == ErrorKind::PermissionDenied => {
                saw_denied = true;
            }
            Err(_) => {
                // NotFound / other — inconclusive. Keep looking.
            }
        }
    }
    !saw_denied
}

/// Non-macOS stub. There's no equivalent system-wide privacy gate on
/// Windows / Linux that maps cleanly to FDA, so the answer is always
/// "granted" — the frontend prompt never fires off-platform.
#[cfg(not(target_os = "macos"))]
pub fn has_full_disk_access() -> bool {
    true
}

/// Open the System Settings → Privacy & Security → Full Disk Access
/// pane via the documented `x-apple.systempreferences:` URL scheme.
/// The `open` shell verb knows how to route it. Routed through
/// [`crate::win_cmd::hidden_command`] to satisfy the project-wide
/// no-bare-`Command::new` rule (the helper is a `Command::new` no-op
/// on macOS but is the path future cross-platform extensions need).
#[cfg(target_os = "macos")]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    crate::win_cmd::hidden_command("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open System Settings (FDA): {e}"))
}

/// Non-macOS stub. Reject loudly so a frontend caller that
/// accidentally invokes the command off-platform sees an actionable
/// error instead of a silent success.
#[cfg(not(target_os = "macos"))]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    Err("Full Disk Access is a macOS-only privacy setting".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `has_full_disk_access` returns SOMETHING (true or false) without
    /// panicking on every target. The exact value depends on the host
    /// (CI macOS runners don't have FDA; Linux / Windows always return
    /// `true`), so we don't assert on the value — only that the probe
    /// completes cleanly.
    #[test]
    fn has_full_disk_access_does_not_panic() {
        let _ = has_full_disk_access();
    }

    /// Non-macOS targets must reject the open-settings call with a
    /// non-empty error message so a frontend caller sees an actionable
    /// surface (rather than a silent `Ok(())` that misleads).
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn open_settings_rejects_off_platform() {
        let res = open_full_disk_access_settings();
        assert!(res.is_err());
        assert!(!res.unwrap_err().is_empty());
    }
}
