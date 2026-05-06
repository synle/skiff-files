//! `cpstamp` — copy a file with a timestamp suffix.
//!
//! Mirrors the bash `cpstamp` from the user's `bash-file-utils.profile.bash`:
//! given `/src/foo.txt`, produces `<dest>/foo.txt.YYYY_MM_DD_HH_MM`. Useful
//! for "snapshot this config before I edit it" flows.

use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

/// Compute the stamped destination path. Pulled out as a pure function so
/// timestamp formatting is unit-testable without a clock injection.
pub fn stamped_name(name: &str, ts: &str) -> String {
    format!("{name}.{ts}")
}

/// Build the timestamp string the bash original used: `YYYY_MM_DD_HH_MM`
/// in local time. Local time matches the user's mental model — backups
/// taken at "9am" want "09" in the filename, not whatever UTC offset is.
pub fn current_timestamp() -> String {
    Local::now().format("%Y_%m_%d_%H_%M").to_string()
}

/// Public entry: copy `src` (must be a file) into `dest_dir` with a
/// timestamp suffix. `dest_dir` is created if missing. Returns the path
/// the file was actually written to so the UI can navigate to it.
pub fn cpstamp(src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let md = fs::metadata(src).map_err(|e| format!("stat({}): {e}", src.display()))?;
    if md.is_dir() {
        return Err(format!("cpstamp: src must be a file: {}", src.display()));
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("cpstamp: src has no usable name: {}", src.display()))?;
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("mkdir({}): {e}", dest_dir.display()))?;
    let target = dest_dir.join(stamped_name(name, &current_timestamp()));
    fs::copy(src, &target).map_err(|e| {
        format!("cpstamp copy({} -> {}): {e}", src.display(), target.display())
    })?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn uniq() -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{t}-{n}")
    }

    #[test]
    fn stamped_name_appends_suffix() {
        assert_eq!(
            stamped_name("foo.txt", "2026_05_06_13_45"),
            "foo.txt.2026_05_06_13_45"
        );
    }

    #[test]
    fn current_timestamp_has_expected_shape() {
        let ts = current_timestamp();
        // YYYY_MM_DD_HH_MM = 4 + 2 + 2 + 2 + 2 + 4 underscores = 16 chars.
        assert_eq!(ts.len(), 16);
        assert!(ts.chars().filter(|c| *c == '_').count() == 4);
    }

    #[test]
    fn cpstamp_writes_a_stamped_sibling() {
        let root = std::env::temp_dir().join(format!("skiff-stamp-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        let src = root.join("hello.txt");
        File::create(&src).unwrap().write_all(b"hi").unwrap();
        let dest_dir = root.join("backups");
        let out = cpstamp(&src, &dest_dir).unwrap();
        assert!(out.starts_with(&dest_dir));
        let name = out.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("hello.txt."));
        assert_eq!(fs::read(&out).unwrap(), b"hi");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cpstamp_errors_on_directory_src() {
        let root = std::env::temp_dir().join(format!("skiff-stamp-dir-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        let result = cpstamp(&root, &root);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
