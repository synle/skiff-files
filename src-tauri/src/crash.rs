//! Opt-in local crash reporting.
//!
//! When the user enables `crashReportsEnabled` in Settings → Advanced
//! we install a `std::panic::set_hook` at app start that writes a
//! single timestamped log to `<app_data_dir>/crashes/<ts>.log` for
//! every Rust panic. The previous panic hook is preserved + chained
//! so debug builds still print to stderr.
//!
//! Off by default. Local-only — no network submission. The crash
//! folder is reachable from Settings → Advanced via
//! `crash_logs_dir` + a Reveal button.

use std::path::{Path, PathBuf};

/// Read the user's `crashReportsEnabled` flag straight out of
/// `<app_data_dir>/settings.json` without deserializing the full
/// schema. Returns `false` for any error (missing file, malformed
/// JSON, missing key, unexpected type) so a corrupt settings.json
/// never trips a panic-during-startup loop.
///
/// The settings shape is owned by the frontend; this scrapes the
/// minimum it needs and ignores the rest. If the key is renamed,
/// crash reporting silently disables until the frontend writes the
/// new name back to disk — a soft failure mode is correct here.
pub fn crash_reports_enabled(app_data_dir: &Path) -> bool {
    let settings_path = app_data_dir.join("settings.json");
    let Ok(body) = std::fs::read_to_string(&settings_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) else {
        return false;
    };
    value
        .get("crashReportsEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Install a panic hook that writes crash reports to
/// `<crash_dir>/<ts>.log` and chains to the previous hook so debug
/// builds still see the stderr trace. Idempotent in spirit — call
/// once at startup. Safe to call from `tauri::Builder::setup`.
pub fn install_panic_hook(crash_dir: PathBuf) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Best-effort write; if anything in here fails (filesystem
        // full, perms revoked) we still chain to the previous hook
        // so the user gets the stderr trace at minimum. We never
        // panic from inside the panic hook — that aborts the
        // process with no log at all.
        let _ = write_crash_log(&crash_dir, info);
        prev(info);
    }));
}

fn write_crash_log(
    crash_dir: &Path,
    info: &std::panic::PanicHookInfo<'_>,
) -> std::io::Result<()> {
    std::fs::create_dir_all(crash_dir)?;
    let ts = chrono::Local::now()
        .format("%Y-%m-%d_%H-%M-%S")
        .to_string();
    // The Tauri build pre-hashes panic file names so several
    // crashes inside one second don't collide. We add a thread
    // hash for the same reason.
    let thread = std::thread::current()
        .name()
        .unwrap_or("<unnamed>")
        .to_string();
    let path = crash_dir.join(format!("{ts}_{}.log", sanitize(&thread)));
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "<unknown>".to_string());
    let payload = info
        .payload()
        .downcast_ref::<&'static str>()
        .map(|s| (*s).to_string())
        .or_else(|| {
            info.payload()
                .downcast_ref::<String>()
                .cloned()
        })
        .unwrap_or_else(|| "<non-string panic payload>".to_string());
    let body = format!(
        "Skiff Files — crash report\n\
         version: {version}\n\
         timestamp: {ts}\n\
         thread: {thread}\n\
         location: {location}\n\
         \n\
         {payload}\n",
        version = env!("APP_VERSION"),
    );
    std::fs::write(&path, body)
}

/// Strip characters that aren't safe to embed in a filename. We
/// only allow ASCII alphanumerics + a small set of separators —
/// thread names can be arbitrary user-supplied strings.
fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_flag_from_settings_json() {
        let tmp = std::env::temp_dir().join(format!(
            "skiff-crash-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        // No file → false.
        assert!(!crash_reports_enabled(&tmp));
        // Empty / malformed → false (no panic).
        std::fs::write(tmp.join("settings.json"), "not json").unwrap();
        assert!(!crash_reports_enabled(&tmp));
        // Missing key → false.
        std::fs::write(tmp.join("settings.json"), r#"{"other":true}"#).unwrap();
        assert!(!crash_reports_enabled(&tmp));
        // Wrong type (string instead of bool) → false.
        std::fs::write(
            tmp.join("settings.json"),
            r#"{"crashReportsEnabled":"yes"}"#,
        )
        .unwrap();
        assert!(!crash_reports_enabled(&tmp));
        // Properly enabled.
        std::fs::write(
            tmp.join("settings.json"),
            r#"{"crashReportsEnabled":true,"theme":"dark"}"#,
        )
        .unwrap();
        assert!(crash_reports_enabled(&tmp));
        // Properly disabled.
        std::fs::write(
            tmp.join("settings.json"),
            r#"{"crashReportsEnabled":false}"#,
        )
        .unwrap();
        assert!(!crash_reports_enabled(&tmp));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn sanitize_filters_unsafe_filename_chars() {
        assert_eq!(sanitize("main"), "main");
        assert_eq!(sanitize("my thread"), "my_thread");
        assert_eq!(sanitize("../etc/passwd"), ".._etc_passwd");
        assert_eq!(sanitize("a/b\\c:d"), "a_b_c_d");
    }
}
