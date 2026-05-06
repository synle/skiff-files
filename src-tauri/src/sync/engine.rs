//! Job executor. Given a planned file list + options, walks the list and
//! either copies, skips, or surfaces a conflict per file. Emits progress
//! events as it goes.
//!
//! The cancellation token is checked between files (not within a copy)
//! so a cancel-mid-large-file might wait for the current file to finish.
//! That trade-off keeps the executor simple; cancelling a multi-GB file
//! mid-stream lands in Phase 4b.

use super::plan::PlannedFile;
use super::types::{ConflictPolicy, FileOutcome, JobOptions, Progress, Summary};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Token the registry hands the executor; flipping it true makes the
/// next inter-file checkpoint return early.
#[derive(Default)]
pub struct CancelToken {
    flag: AtomicBool,
}

impl CancelToken {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::Relaxed);
    }
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

/// Decide whether `src` and existing `dest` should skip per the
/// "unchanged" heuristic. Returns `Some(reason)` if we should skip, or
/// `None` to proceed with the conflict policy. Mirrors `cpsync`: same
/// size is enough for binary-shaped files; with `lookback_days > 0` we
/// also accept files older than that as identical when sizes match.
fn should_skip_unchanged(
    src: &PlannedFile,
    dest_meta: &fs::Metadata,
    lookback_days: u64,
) -> Option<String> {
    if dest_meta.len() != src.size {
        return None;
    }
    if lookback_days == 0 {
        return Some("same size".into());
    }
    // Pull dest mtime — if the platform won't tell us, fall back to
    // size-only.
    let dest_mtime = dest_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    match (src.mtime, dest_mtime) {
        (Some(s), Some(d)) => {
            // If both files are older than `lookback_days`, treat
            // matching size as proof of equality. The window scales with
            // user expectation: source code changes within the last week
            // are "interesting", everything older is "stable".
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let window = (lookback_days * 86_400) as i64;
            if now - s > window && now - d > window {
                Some("same size, both older than lookback".into())
            } else if s == d {
                Some("same size + same mtime".into())
            } else {
                None
            }
        }
        _ => Some("same size".into()),
    }
}

/// Adjust `dest` for the "keep both" conflict policy: append `(2)`,
/// `(3)`, ... before the extension until we find an unused name. The
/// suffix scheme matches macOS Finder and Windows Explorer.
fn keep_both_path(dest: &PlannedFile) -> PathBuf {
    let stem = dest
        .dest
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = dest
        .dest
        .extension()
        .map(|s| s.to_string_lossy().into_owned());
    let parent = dest
        .dest
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    for n in 2..1_000_000 {
        let name = match &ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    // Astronomically unlikely; fall back to the original so we surface a
    // conflict rather than spinning forever.
    dest.dest.clone()
}

/// Per-file step that updates counters + builds the right
/// [`FileOutcome`]. Returns the bytes that were actually written so the
/// running total can advance.
fn process_file(
    file: &PlannedFile,
    opts: &JobOptions,
    summary: &mut Summary,
) -> FileOutcome {
    let dest = &file.dest;

    // Conflict + unchanged checks only matter when dest exists.
    if let Ok(dest_md) = fs::metadata(dest) {
        if let Some(reason) = should_skip_unchanged(file, &dest_md, opts.lookback_days) {
            summary.skipped += 1;
            return FileOutcome::Skipped {
                src: file.src.to_string_lossy().into_owned(),
                dest: dest.to_string_lossy().into_owned(),
                reason,
            };
        }
        match opts.conflict_policy {
            ConflictPolicy::Skip => {
                summary.conflicts += 1;
                return FileOutcome::Conflict {
                    src: file.src.to_string_lossy().into_owned(),
                    dest: dest.to_string_lossy().into_owned(),
                    reason: "exists; policy=skip".into(),
                };
            }
            ConflictPolicy::Overwrite => { /* fall through to copy */ }
            ConflictPolicy::KeepBoth => {
                // Pick a fresh sibling and rebind for the copy below.
                let renamed = keep_both_path(file);
                if opts.dry_run {
                    summary.copied += 1;
                    summary.bytes_copied += file.size;
                    return FileOutcome::Copied {
                        src: file.src.to_string_lossy().into_owned(),
                        dest: renamed.to_string_lossy().into_owned(),
                        bytes: file.size,
                    };
                }
                if let Some(parent) = renamed.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                return match copy_with_fallback(&file.src, &renamed) {
                    Ok(n) => {
                        summary.copied += 1;
                        summary.bytes_copied += n;
                        FileOutcome::Copied {
                            src: file.src.to_string_lossy().into_owned(),
                            dest: renamed.to_string_lossy().into_owned(),
                            bytes: n,
                        }
                    }
                    Err(e) => {
                        summary.errors += 1;
                        FileOutcome::Error {
                            src: file.src.to_string_lossy().into_owned(),
                            dest: renamed.to_string_lossy().into_owned(),
                            error: e,
                        }
                    }
                };
            }
        }
    }

    // Default path: copy `src -> dest` (overwriting if present).
    if opts.dry_run {
        summary.copied += 1;
        summary.bytes_copied += file.size;
        return FileOutcome::Copied {
            src: file.src.to_string_lossy().into_owned(),
            dest: dest.to_string_lossy().into_owned(),
            bytes: file.size,
        };
    }
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match copy_with_fallback(&file.src, dest) {
        Ok(n) => {
            summary.copied += 1;
            summary.bytes_copied += n;
            FileOutcome::Copied {
                src: file.src.to_string_lossy().into_owned(),
                dest: dest.to_string_lossy().into_owned(),
                bytes: n,
            }
        }
        Err(e) => {
            summary.errors += 1;
            FileOutcome::Error {
                src: file.src.to_string_lossy().into_owned(),
                dest: dest.to_string_lossy().into_owned(),
                error: e,
            }
        }
    }
}

/// Mirror of `cpsync`'s safe-copy: try the kernel-accelerated path
/// (`fs::copy` uses `copy_file_range` / `FICLONE` on Linux and
/// `clonefile` on macOS), and fall back to plain read+write on EPERM —
/// SMB / NTFS network mounts reject the accelerated paths.
fn copy_with_fallback(src: &std::path::Path, dest: &std::path::Path) -> Result<u64, String> {
    match fs::copy(src, dest) {
        Ok(n) => Ok(n),
        Err(_) => {
            let bytes = fs::read(src)
                .map_err(|e| format!("read({}): {e}", src.display()))?;
            let len = bytes.len() as u64;
            fs::write(dest, bytes)
                .map_err(|e| format!("write({}): {e}", dest.display()))?;
            Ok(len)
        }
    }
}

/// Execute a planned job. `on_progress` is called after each file with
/// the running totals so the Tauri command layer can emit `sync:progress`
/// events. Returns the final summary (including a `cancelled` flag if the
/// token tripped).
pub fn execute(
    job_id: &str,
    files: &[PlannedFile],
    total_bytes: u64,
    opts: &JobOptions,
    cancel: Arc<CancelToken>,
    mut on_progress: impl FnMut(Progress),
) -> Summary {
    let mut summary = Summary {
        job_id: job_id.to_string(),
        copied: 0,
        skipped: 0,
        conflicts: 0,
        errors: 0,
        bytes_copied: 0,
        cancelled: false,
    };
    let total_files = files.len() as u64;
    let mut bytes_seen: u64 = 0;

    for (i, file) in files.iter().enumerate() {
        if cancel.is_cancelled() {
            summary.cancelled = true;
            return summary;
        }
        let outcome = process_file(file, opts, &mut summary);
        bytes_seen += file.size;
        on_progress(Progress {
            job_id: job_id.to_string(),
            files_total: total_files,
            files_done: (i as u64) + 1,
            bytes_total: total_bytes,
            bytes_done: bytes_seen,
            last: Some(outcome),
        });
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::plan;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;

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

    /// Build a fresh `(src_root, dest_root)` pair, populated with one
    /// file at the top and one in a subdirectory.
    fn fixture() -> (PathBuf, PathBuf) {
        let src = std::env::temp_dir().join(format!("skiff-engine-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-engine-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        File::create(src.join("a.txt"))
            .unwrap()
            .write_all(b"hello")
            .unwrap();
        fs::create_dir(src.join("sub")).unwrap();
        File::create(src.join("sub/b.txt"))
            .unwrap()
            .write_all(b"world!")
            .unwrap();
        (src, dest)
    }

    fn run_default(src: &PathBuf, dest: &PathBuf, opts: JobOptions) -> Summary {
        let (files, total) = plan::plan(src, dest).unwrap();
        execute(
            "test-job",
            &files,
            total,
            &opts,
            CancelToken::new(),
            |_p| {},
        )
    }

    #[test]
    fn copies_a_full_tree() {
        let (src, dest) = fixture();
        let s = run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::Overwrite,
            dry_run: false,
        });
        assert_eq!(s.copied, 2);
        assert_eq!(s.errors, 0);
        assert!(dest.join("a.txt").exists());
        assert!(dest.join("sub/b.txt").exists());
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn skips_unchanged_on_second_run() {
        let (src, dest) = fixture();
        run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::Overwrite,
            dry_run: false,
        });
        let s2 = run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::Overwrite,
            dry_run: false,
        });
        assert_eq!(s2.copied, 0);
        assert_eq!(s2.skipped, 2);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn conflict_policy_skip_leaves_dest_untouched() {
        let (src, dest) = fixture();
        // Pre-populate dest with a different-sized file at a.txt.
        fs::create_dir_all(&dest).unwrap();
        File::create(dest.join("a.txt"))
            .unwrap()
            .write_all(b"OLD-DIFFERENT-SIZE")
            .unwrap();
        let s = run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::Skip,
            dry_run: false,
        });
        // Different sizes -> not "unchanged"; policy=skip -> conflict, no overwrite.
        assert!(s.conflicts >= 1);
        let bytes = fs::read(dest.join("a.txt")).unwrap();
        assert_eq!(bytes, b"OLD-DIFFERENT-SIZE");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn keep_both_creates_renamed_sibling() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        File::create(dest.join("a.txt"))
            .unwrap()
            .write_all(b"existing-different")
            .unwrap();
        let s = run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::KeepBoth,
            dry_run: false,
        });
        // a.txt remains the "existing-different" file; the new copy lands
        // at a (2).txt.
        assert!(s.copied >= 1);
        assert!(dest.join("a (2).txt").exists());
        let original = fs::read(dest.join("a.txt")).unwrap();
        assert_eq!(original, b"existing-different");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn dry_run_writes_nothing() {
        let (src, dest) = fixture();
        let s = run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::Overwrite,
            dry_run: true,
        });
        assert_eq!(s.copied, 2);
        assert!(!dest.join("a.txt").exists());
        let _ = fs::remove_dir_all(&src);
    }

    #[test]
    fn cancellation_aborts_between_files() {
        let (src, dest) = fixture();
        let (files, total) = plan::plan(&src, &dest).unwrap();
        let token = CancelToken::new();
        token.cancel(); // pre-cancelled
        let s = execute(
            "test",
            &files,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Overwrite,
                dry_run: false,
            },
            token,
            |_| {},
        );
        assert!(s.cancelled);
        assert_eq!(s.copied, 0);
        let _ = fs::remove_dir_all(&src);
    }
}
