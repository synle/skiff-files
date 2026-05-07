//! Job executor. Given a planned file list + options, walks the list and
//! either copies, skips, or surfaces a conflict per file. Emits progress
//! events as it goes.
//!
//! The cancellation token is checked between files (not within a copy)
//! so a cancel-mid-large-file might wait for the current file to finish.
//! That trade-off keeps the executor simple; cancelling a multi-GB file
//! mid-stream lands in Phase 4b.

use super::plan::PlannedFile;
use super::types::{
    ConflictPolicy, ConflictPromptDecision, FileOutcome, JobOptions, Progress, Summary,
};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Shared control token for the executor. Two independent flags:
///
/// - `cancel` — flip true to abort at the next inter-file checkpoint.
///   Once set, never clears (a cancelled job cannot be resumed; the
///   user must start a new one).
/// - `pause`  — when true, the executor blocks between files. Toggle
///   freely with `pause()` / `resume()`. A paused job can also be
///   cancelled — the wait loop exits immediately.
#[derive(Default)]
pub struct CancelToken {
    cancel: AtomicBool,
    pause: AtomicBool,
}

impl CancelToken {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
    pub fn pause(&self) {
        self.pause.store(true, Ordering::Relaxed);
    }
    pub fn resume(&self) {
        self.pause.store(false, Ordering::Relaxed);
    }
    pub fn is_paused(&self) -> bool {
        self.pause.load(Ordering::Relaxed)
    }

    /// Block while paused. Returns `true` if the wait was broken by a
    /// cancel — in that case the executor should bail. Polls every
    /// 50 ms; that's tight enough for the UI to feel responsive
    /// (resume → next file kicks off in under one frame) without
    /// burning CPU on idle jobs.
    pub fn wait_if_paused(&self) -> bool {
        while self.is_paused() && !self.is_cancelled() {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        self.is_cancelled()
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

/// Aside-rename the existing dest to `name (old).ext`. If `(old)` is
/// already taken (rare — happens when a previous renameTarget pass left
/// one behind), suffix with `(old N)`. Returns the path the existing
/// file was moved to.
fn aside_rename_existing(dest: &std::path::Path) -> Result<PathBuf, String> {
    let stem = dest
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = dest
        .extension()
        .map(|s| s.to_string_lossy().into_owned());
    let parent = dest
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let make = |suffix: String| {
        let name = match &ext {
            Some(e) => format!("{stem} ({suffix}).{e}"),
            None => format!("{stem} ({suffix})"),
        };
        parent.join(name)
    };
    let mut target = make("old".into());
    let mut n = 2;
    while target.exists() {
        target = make(format!("old {n}"));
        n += 1;
        if n > 1_000_000 {
            return Err(format!(
                "couldn't find a free aside-rename slot for {}",
                dest.display()
            ));
        }
    }
    fs::rename(dest, &target)
        .map_err(|e| format!("rename({} -> {}): {e}", dest.display(), target.display()))?;
    Ok(target)
}

/// Decide what `process_file` should do for the given conflict-policy /
/// metadata combination. Pulled out as a pure function so each branch
/// has a focused unit test instead of a giant integration setup.
///
/// Variants:
/// - `Copy`           — proceed with overwrite at `file.dest`
/// - `Skip(reason)`   — leave dest untouched, count as conflict
/// - `KeepBoth`       — write to a `(2)` sibling
/// - `RenameTarget`   — aside-rename existing then copy under original name
fn resolve_conflict(
    policy: ConflictPolicy,
    src: &PlannedFile,
    dest_meta: &fs::Metadata,
) -> ConflictDecision {
    match policy {
        ConflictPolicy::Skip => ConflictDecision::Skip("exists; policy=skip".into()),
        ConflictPolicy::Overwrite => ConflictDecision::Copy,
        ConflictPolicy::KeepBoth => ConflictDecision::KeepBoth,
        ConflictPolicy::OverwriteOlder => {
            if dest_is_older(src, dest_meta) {
                ConflictDecision::Copy
            } else {
                ConflictDecision::Skip("dest not older".into())
            }
        }
        ConflictPolicy::ReplaceSmaller => {
            if dest_meta.len() < src.size {
                ConflictDecision::Copy
            } else {
                ConflictDecision::Skip("dest not smaller".into())
            }
        }
        ConflictPolicy::ReplaceIfSizeDifferent => {
            if dest_meta.len() != src.size {
                ConflictDecision::Copy
            } else {
                ConflictDecision::Skip("same size".into())
            }
        }
        ConflictPolicy::RenameTarget => ConflictDecision::RenameTarget,
        ConflictPolicy::RenameOlderTarget => {
            if dest_is_older(src, dest_meta) {
                ConflictDecision::RenameTarget
            } else {
                ConflictDecision::Skip("dest not older".into())
            }
        }
        // The actual prompt is dispatched by `process_file` (it has the
        // closure); resolve_conflict just signals "ask the user".
        ConflictPolicy::Prompt => ConflictDecision::PromptUser,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ConflictDecision {
    Copy,
    Skip(String),
    KeepBoth,
    RenameTarget,
    /// `ConflictPolicy::Prompt` only — the executor must invoke the
    /// frontend prompt closure and translate its answer into one of the
    /// concrete variants above.
    PromptUser,
}

/// Translate a frontend prompt decision into our internal one. Used by
/// `process_file` after a `PromptUser` outcome resolves. The "Apply
/// to all" variants normalize to their per-file equivalents — the
/// command-layer closure is responsible for caching the All choice so
/// subsequent conflicts skip the modal.
fn from_prompt_decision(d: ConflictPromptDecision) -> ConflictDecision {
    match d.normalized() {
        ConflictPromptDecision::Overwrite => ConflictDecision::Copy,
        ConflictPromptDecision::Skip => ConflictDecision::Skip("user skipped".into()),
        ConflictPromptDecision::KeepBoth => ConflictDecision::KeepBoth,
        ConflictPromptDecision::CancelJob => {
            ConflictDecision::Skip("job cancelled".into())
        }
        // normalized() removes the All variants; the unreachable arm
        // is purely a safety net for future enum expansion.
        ConflictPromptDecision::OverwriteAll
        | ConflictPromptDecision::SkipAll
        | ConflictPromptDecision::KeepBothAll => {
            unreachable!("normalized() drops the All variants")
        }
    }
}

/// True when the destination's mtime is older than the source's. If
/// either platform refuses to surface a usable mtime, we err on the
/// side of "not older" — better to skip than to clobber.
fn dest_is_older(src: &PlannedFile, dest_meta: &fs::Metadata) -> bool {
    let src_mtime = match src.mtime {
        Some(m) => m,
        None => return false,
    };
    let dest_mtime = dest_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    match dest_mtime {
        Some(d) => d < src_mtime,
        None => false,
    }
}

/// Per-file step. Decides what to do via `resolve_conflict` and then
/// performs the IO (or fakes it for dry-run). Returns the outcome to
/// emit and updates counters in `summary`.
///
/// `on_prompt` is invoked when the policy is `Prompt`; it should emit
/// the `sync:conflict` event and block on the resolver hub, returning
/// the user's choice. Returning `None` is treated as a job cancel.
fn process_file<F>(
    file: &PlannedFile,
    opts: &JobOptions,
    summary: &mut Summary,
    on_prompt: &mut F,
) -> FileOutcome
where
    F: FnMut(&PlannedFile, &fs::Metadata) -> Option<ConflictPromptDecision>,
{
    let dest = &file.dest;
    let src_str = || file.src.to_string_lossy().into_owned();

    // Conflict + unchanged checks only matter when dest exists.
    if let Ok(dest_md) = fs::metadata(dest) {
        if let Some(reason) = should_skip_unchanged(file, &dest_md, opts.lookback_days) {
            summary.skipped += 1;
            return FileOutcome::Skipped {
                src: src_str(),
                dest: dest.to_string_lossy().into_owned(),
                reason,
            };
        }
        let mut decision = resolve_conflict(opts.conflict_policy, file, &dest_md);
        if matches!(decision, ConflictDecision::PromptUser) {
            decision = match on_prompt(file, &dest_md) {
                Some(d) => from_prompt_decision(d),
                // Cancel — the outer loop will catch the cancel flag and
                // bail. For this file, treat as skip so the summary
                // reflects "user backed out".
                None => ConflictDecision::Skip("user cancelled".into()),
            };
        }
        match decision {
            ConflictDecision::Skip(reason) => {
                summary.conflicts += 1;
                return FileOutcome::Conflict {
                    src: src_str(),
                    dest: dest.to_string_lossy().into_owned(),
                    reason,
                };
            }
            ConflictDecision::Copy => { /* fall through to overwrite */ }
            ConflictDecision::KeepBoth => {
                let renamed = keep_both_path(file);
                return do_copy(file, &renamed, opts, summary);
            }
            ConflictDecision::RenameTarget => {
                if opts.dry_run {
                    summary.copied += 1;
                    summary.bytes_copied += file.size;
                    return FileOutcome::Copied {
                        src: src_str(),
                        dest: dest.to_string_lossy().into_owned(),
                        bytes: file.size,
                    };
                }
                match aside_rename_existing(dest) {
                    Ok(_) => { /* dest is now free; fall through to copy */ }
                    Err(e) => {
                        summary.errors += 1;
                        return FileOutcome::Error {
                            src: src_str(),
                            dest: dest.to_string_lossy().into_owned(),
                            error: e,
                        };
                    }
                }
            }
            // Unreachable: `PromptUser` is always translated into a
            // concrete variant by the if-block above before reaching
            // this match.
            ConflictDecision::PromptUser => unreachable!("prompt resolved upstream"),
        }
    }

    do_copy(file, dest, opts, summary)
}

/// Perform the actual write at `target`. Shared between the default and
/// keep-both paths so the dry-run + parent-mkdir + error-mapping logic
/// lives in one place.
fn do_copy(
    file: &PlannedFile,
    target: &std::path::Path,
    opts: &JobOptions,
    summary: &mut Summary,
) -> FileOutcome {
    let src_str = file.src.to_string_lossy().into_owned();
    let dest_str = target.to_string_lossy().into_owned();
    if opts.dry_run {
        summary.copied += 1;
        summary.bytes_copied += file.size;
        return FileOutcome::Copied {
            src: src_str,
            dest: dest_str,
            bytes: file.size,
        };
    }
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match copy_with_fallback(&file.src, target, opts.bandwidth_kbps) {
        Ok(n) => {
            // Optional post-copy size-match verify. Catches truncations
            // and partial writes that wouldn't otherwise surface until
            // the user opened the destination later.
            if opts.verify_after_copy {
                match fs::metadata(target) {
                    Ok(md) if md.len() != file.size => {
                        summary.errors += 1;
                        return FileOutcome::Error {
                            src: src_str,
                            dest: dest_str,
                            error: format!(
                                "verify failed: src {} bytes, dest {} bytes",
                                file.size,
                                md.len()
                            ),
                        };
                    }
                    Err(e) => {
                        summary.errors += 1;
                        return FileOutcome::Error {
                            src: src_str,
                            dest: dest_str,
                            error: format!("verify stat failed: {e}"),
                        };
                    }
                    _ => {}
                }
            }
            summary.copied += 1;
            summary.bytes_copied += n;
            FileOutcome::Copied {
                src: src_str,
                dest: dest_str,
                bytes: n,
            }
        }
        Err(e) => {
            summary.errors += 1;
            FileOutcome::Error {
                src: src_str,
                dest: dest_str,
                error: e,
            }
        }
    }
}

/// Mirror of `cpsync`'s safe-copy: try the kernel-accelerated path
/// (`fs::copy` uses `copy_file_range` / `FICLONE` on Linux and
/// `clonefile` on macOS), and fall back to plain read+write on EPERM —
/// SMB / NTFS network mounts reject the accelerated paths.
///
/// `bandwidth_kbps == 0` keeps the kernel-accelerated path for
/// maximum throughput. Any non-zero cap forces the chunked path so we
/// can interleave sleeps between writes — there's no way to throttle
/// `fs::copy`.
fn copy_with_fallback(
    src: &std::path::Path,
    dest: &std::path::Path,
    bandwidth_kbps: u64,
) -> Result<u64, String> {
    if bandwidth_kbps == 0 {
        return match fs::copy(src, dest) {
            Ok(n) => Ok(n),
            Err(_) => {
                let bytes = fs::read(src)
                    .map_err(|e| format!("read({}): {e}", src.display()))?;
                let len = bytes.len() as u64;
                fs::write(dest, bytes)
                    .map_err(|e| format!("write({}): {e}", dest.display()))?;
                Ok(len)
            }
        };
    }
    copy_throttled(src, dest, bandwidth_kbps)
}

/// Chunked read+write+sleep loop. Sleeps between chunks so the running
/// average byte rate stays at or below `bandwidth_kbps`. 64 KB chunks
/// match the tokio default + give a reasonable sleep granularity (at
/// 1 MB/s the loop sleeps ~64 ms per chunk; at 100 MB/s, ~640 µs).
fn copy_throttled(
    src: &std::path::Path,
    dest: &std::path::Path,
    bandwidth_kbps: u64,
) -> Result<u64, String> {
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};
    let mut reader = fs::File::open(src)
        .map_err(|e| format!("open({}): {e}", src.display()))?;
    let mut writer = fs::File::create(dest)
        .map_err(|e| format!("create({}): {e}", dest.display()))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    let bytes_per_sec = bandwidth_kbps.saturating_mul(1024);
    let start = Instant::now();
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read({}): {e}", src.display()))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("write({}): {e}", dest.display()))?;
        total += n as u64;
        // Pace via "expected elapsed at this byte count" — drift-free
        // even when the underlying IO is bursty.
        let expected_ms = (total.saturating_mul(1000)) / bytes_per_sec.max(1);
        let actual_ms = start.elapsed().as_millis() as u64;
        if expected_ms > actual_ms {
            std::thread::sleep(Duration::from_millis(expected_ms - actual_ms));
        }
    }
    writer
        .flush()
        .map_err(|e| format!("flush({}): {e}", dest.display()))?;
    Ok(total)
}

/// Execute a planned job. `on_progress` is called after each file with
/// the running totals so the Tauri command layer can emit `sync:progress`
/// events. `on_prompt` runs only when the policy is `Prompt`; the
/// command layer wires it to the `ResolverHub` so the modal in the
/// frontend gets a chance to answer. Returns the final summary
/// (including a `cancelled` flag if the token tripped).
pub fn execute(
    job_id: &str,
    files: &[PlannedFile],
    total_bytes: u64,
    opts: &JobOptions,
    cancel: Arc<CancelToken>,
    mut on_progress: impl FnMut(Progress),
    mut on_prompt: impl FnMut(&PlannedFile, &fs::Metadata) -> Option<ConflictPromptDecision>,
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
        // Block here while paused so the executor doesn't burn CPU. Returns
        // true if the wait was interrupted by a cancel.
        if cancel.wait_if_paused() {
            summary.cancelled = true;
            return summary;
        }
        let outcome = process_file(file, opts, &mut summary, &mut on_prompt);
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
            // Tests use non-Prompt policies; this closure is never invoked.
            |_f, _md| None,
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
            bandwidth_kbps: 0,
            verify_after_copy: false,
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
            bandwidth_kbps: 0,
            verify_after_copy: false,
        });
        let s2 = run_default(&src, &dest, JobOptions {
            max_size_gb: 1,
            lookback_days: 0,
            conflict_policy: ConflictPolicy::Overwrite,
            dry_run: false,
            bandwidth_kbps: 0,
            verify_after_copy: false,
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
            bandwidth_kbps: 0,
            verify_after_copy: false,
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
            bandwidth_kbps: 0,
            verify_after_copy: false,
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
            bandwidth_kbps: 0,
            verify_after_copy: false,
        });
        assert_eq!(s.copied, 2);
        assert!(!dest.join("a.txt").exists());
        let _ = fs::remove_dir_all(&src);
    }

    /// Convenience: stomp `dest/a.txt` to a different size + force its
    /// mtime so we can assert older/newer policies deterministically.
    fn poke(path: &PathBuf, contents: &[u8], mtime_offset_secs: i64) {
        fs::write(path, contents).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let target = std::time::UNIX_EPOCH
            + std::time::Duration::from_secs((now + mtime_offset_secs).max(0) as u64);
        let _ = filetime::set_file_mtime(path, filetime::FileTime::from_system_time(target));
    }

    #[test]
    fn overwrite_older_overwrites_only_when_dest_is_older() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        // Pre-populate dest with old, smaller-but-different content.
        poke(&dest.join("a.txt"), b"OLD", -3600); // 1h old
        // src/a.txt is newer (just created in fixture()).
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::OverwriteOlder,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.copied >= 1, "expected at least one overwrite, got {s:?}");
        // a.txt should now match src ("hello").
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"hello");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn overwrite_older_skips_when_dest_is_newer() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        // Make dest newer than src — and different size so the
        // skip-if-unchanged heuristic doesn't short-circuit before the
        // conflict policy gets a chance to evaluate.
        poke(&dest.join("a.txt"), b"NEWER-AND-DIFFERENT-SIZE", 3600);
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::OverwriteOlder,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.conflicts >= 1);
        // dest content untouched.
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"NEWER-AND-DIFFERENT-SIZE");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn replace_smaller_overwrites_only_when_dest_smaller_than_src() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        // src/a.txt is "hello" = 5 bytes. Pre-populate dest with 2 bytes.
        fs::write(dest.join("a.txt"), b"OK").unwrap();
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::ReplaceSmaller,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.copied >= 1);
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"hello");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn replace_smaller_skips_when_dest_larger() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("a.txt"), b"a much larger payload").unwrap();
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::ReplaceSmaller,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.conflicts >= 1);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn replace_if_size_different_overwrites_when_size_differs() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("a.txt"), b"X").unwrap();
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::ReplaceIfSizeDifferent,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.copied >= 1);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn rename_target_aside_renames_existing_then_copies_new_under_original() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("a.txt"), b"PREVIOUS").unwrap();
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::RenameTarget,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.copied >= 1);
        // Original name now holds the new content.
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"hello");
        // The previous version is parked next to it.
        assert!(dest.join("a (old).txt").exists());
        assert_eq!(fs::read(dest.join("a (old).txt")).unwrap(), b"PREVIOUS");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn rename_older_target_only_renames_when_dest_is_older() {
        let (src, dest) = fixture();
        fs::create_dir_all(&dest).unwrap();
        // Newer dest — should NOT be aside-renamed.
        poke(&dest.join("a.txt"), b"FUTURE", 3600);
        let s = run_default(
            &src,
            &dest,
            JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::RenameOlderTarget,
                dry_run: false,
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
        );
        assert!(s.conflicts >= 1);
        assert!(!dest.join("a (old).txt").exists());
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn pause_blocks_until_resume() {
        let (src, dest) = fixture();
        let (files, total) = plan::plan(&src, &dest).unwrap();
        let token = CancelToken::new();
        token.pause();

        // Spawn the executor on a worker; flip resume after ~100 ms.
        let token_for_runner = token.clone();
        let handle = std::thread::spawn(move || {
            execute(
                "test",
                &files,
                total,
                &JobOptions {
                    max_size_gb: 1,
                    lookback_days: 0,
                    conflict_policy: ConflictPolicy::Overwrite,
                    dry_run: false,
                    bandwidth_kbps: 0,
                    verify_after_copy: false,
                },
                token_for_runner,
                |_| {},
                |_f, _md| None,
            )
        });

        // Hold for at least one wait_if_paused poll cycle (50 ms) to
        // prove the executor is truly blocked, then resume.
        std::thread::sleep(std::time::Duration::from_millis(150));
        token.resume();
        let s = handle.join().unwrap();
        assert!(!s.cancelled);
        assert_eq!(s.copied, 2);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn pause_then_cancel_unblocks_wait_and_marks_cancelled() {
        let (src, dest) = fixture();
        let (files, total) = plan::plan(&src, &dest).unwrap();
        let token = CancelToken::new();
        token.pause();

        let token_for_runner = token.clone();
        let handle = std::thread::spawn(move || {
            execute(
                "test",
                &files,
                total,
                &JobOptions {
                    max_size_gb: 1,
                    lookback_days: 0,
                    conflict_policy: ConflictPolicy::Overwrite,
                    dry_run: false,
                    bandwidth_kbps: 0,
                    verify_after_copy: false,
                },
                token_for_runner,
                |_| {},
                |_f, _md| None,
            )
        });

        std::thread::sleep(std::time::Duration::from_millis(100));
        token.cancel();
        let s = handle.join().unwrap();
        assert!(s.cancelled);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
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
                bandwidth_kbps: 0,
                verify_after_copy: false,
            },
            token,
            |_| {},
            |_f, _md| None,
        );
        assert!(s.cancelled);
        assert_eq!(s.copied, 0);
        let _ = fs::remove_dir_all(&src);
    }
}
