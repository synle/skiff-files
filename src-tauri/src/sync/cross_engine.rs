//! Cross-protocol Skiffsync engine. Async, walks any [`Backend`]
//! (local + sftp in 0.2.0; ftp + smb arrive in 0.2.1+).
//!
//! Phase 0.2.0 ships a thin slice: `skip`, `overwrite`, `keepBoth`
//! conflict policies + skip-if-unchanged-by-size. The full TeraCopy
//! smart-batch matrix exists in the local engine and lands here in
//! 0.2.x once we're confident in the async flow. `Prompt` is
//! intentionally not supported here yet — the resolver hub doesn't
//! know about cross jobs and that plumbing is a separate slice.
//!
//! Per-file copies stream via `tokio::io::copy` against
//! [`Backend::open_read`] / [`Backend::open_write`] — no in-memory
//! cap. Local-to-local short-circuits to `std::fs::copy` so the
//! kernel-accelerated path (`clonefile`, `copy_file_range`,
//! `FICLONE`) keeps working.

use super::backend::{walk_files, Backend, PathMeta};
use super::engine::CancelToken;
use super::types::{
    ConflictPolicy, ConflictPromptDecision, FileOutcome, JobOptions, Progress, Summary,
};
use std::future::Future;
use std::path::Path;
use std::sync::Arc;

/// Same shape as [`crate::sync::plan::PlannedFile`] but with String
/// paths because remote paths can't round-trip through `PathBuf` on
/// Windows (POSIX vs `\\`-separated).
#[derive(Debug, Clone)]
pub struct CrossPlannedFile {
    pub src: String,
    pub dest: String,
    pub size: u64,
    pub mtime: Option<i64>,
}

/// Walk `src` with the source backend and produce a flat list of
/// files-to-copy. Destinations are computed by mirroring the relative
/// path from `src_root` onto `dest_root`. Both `src_root` and
/// `dest_root` are absolute strings native to their respective
/// backends.
pub async fn plan_cross(
    src_backend: &Backend,
    src_root: &str,
    dest_root: &str,
) -> Result<(Vec<CrossPlannedFile>, u64), String> {
    let files = walk_files(src_backend, src_root).await?;
    let mut out = Vec::with_capacity(files.len());
    let mut total = 0u64;
    for (abs, size, mtime) in files {
        // Drop the src_root prefix to get the relative path; if the
        // walker handed us the root itself (single-file case), the
        // dest is `dest_root + basename`.
        let rel = abs.strip_prefix(src_root).map(|s| s.trim_start_matches(['/', '\\'])).unwrap_or("");
        let dest = if rel.is_empty() {
            // Single-file case (src_root IS the file). Compute basename.
            let basename = match src_backend {
                Backend::Local => Path::new(&abs)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
                Backend::Sftp(_) => abs
                    .rsplit('/')
                    .next()
                    .unwrap_or("")
                    .to_string(),
            };
            join_dest(dest_root, &basename)
        } else {
            join_dest(dest_root, rel)
        };
        out.push(CrossPlannedFile {
            src: abs,
            dest,
            size,
            mtime,
        });
        total += size;
    }
    Ok((out, total))
}

/// Join a backend-agnostic dest root with a relative segment. We
/// always emit forward slashes — every backend we ship treats them as
/// the path separator (Windows local + std::fs accepts forward
/// slashes too).
fn join_dest(root: &str, rel: &str) -> String {
    let trimmed = root.trim_end_matches(['/', '\\']);
    if rel.is_empty() {
        trimmed.to_string()
    } else {
        format!("{trimmed}/{rel}")
    }
}

/// Whether to skip the file as "unchanged". Mirrors the local
/// engine's heuristic but takes already-fetched metadata so the cross
/// engine doesn't double-stat. Returns `Some(reason)` to skip.
fn unchanged_reason(
    src_size: u64,
    dest_size: u64,
    src_mtime: Option<i64>,
    dest_mtime: Option<i64>,
    lookback_days: u64,
) -> Option<String> {
    if src_size != dest_size {
        return None;
    }
    if lookback_days == 0 {
        return Some("same size".into());
    }
    match (src_mtime, dest_mtime) {
        (Some(s), Some(d)) => {
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

/// Pick the keep-both sibling path on the dest side. Walks `(2)`,
/// `(3)`, ... until `dest.exists()` returns false.
async fn keep_both_path(dest_backend: &Backend, dest: &str) -> String {
    let dot = dest.rfind('.');
    let (stem, ext) = match dot {
        Some(i) if i > 0 && i > dest.rfind('/').unwrap_or(0) => {
            (&dest[..i], Some(&dest[i + 1..]))
        }
        _ => (dest, None),
    };
    for n in 2..1_000_000 {
        let candidate = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let exists = dest_backend
            .metadata(&candidate)
            .await
            .map(|m| m.is_some())
            .unwrap_or(false);
        if !exists {
            return candidate;
        }
    }
    dest.to_string()
}

/// Execute a cross-protocol plan. Mirrors the local engine's loop
/// shape (cancel check, process file, emit progress) but every
/// metadata + IO call is async.
///
/// `on_prompt` runs only when the policy is [`ConflictPolicy::Prompt`].
/// The command layer wires it to the [`crate::sync::resolver::ResolverHub`]
/// so the modal in the frontend gets a chance to answer; for tests
/// you can pass `|_, _| async { None }`.
pub async fn execute_cross<P, Fut>(
    job_id: &str,
    plan: Vec<CrossPlannedFile>,
    total_bytes: u64,
    opts: &JobOptions,
    cancel: Arc<CancelToken>,
    src_backend: Backend,
    dest_backend: Backend,
    mut on_progress: impl FnMut(Progress),
    mut on_prompt: P,
) -> Summary
where
    P: FnMut(CrossPlannedFile, PathMeta) -> Fut,
    Fut: Future<Output = Option<ConflictPromptDecision>>,
{
    let mut summary = Summary {
        job_id: job_id.to_string(),
        copied: 0,
        skipped: 0,
        conflicts: 0,
        errors: 0,
        bytes_copied: 0,
        cancelled: false,
    };
    let total_files = plan.len() as u64;
    let mut bytes_seen: u64 = 0;

    for (i, file) in plan.iter().enumerate() {
        if cancel.is_cancelled() {
            summary.cancelled = true;
            return summary;
        }
        if cancel.wait_if_paused() {
            summary.cancelled = true;
            return summary;
        }
        let outcome = process_one(
            file,
            opts,
            &src_backend,
            &dest_backend,
            &mut summary,
            &mut on_prompt,
        )
        .await;
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

/// Per-file step. Returns a [`FileOutcome`] and updates counters.
/// Conflict policies handled here: skip / overwrite / keepBoth +
/// the metadata-only smart-batch variants (overwriteOlder /
/// replaceSmaller / replaceIfSizeDifferent) + prompt (via the
/// `on_prompt` callback wired by the command layer to the resolver
/// hub). Rename* policies fall through to skip in cross mode (they
/// require a same-backend aside-rename + copy, which the engine
/// hasn't grown yet — landing in 0.2.5).
async fn process_one<P, Fut>(
    file: &CrossPlannedFile,
    opts: &JobOptions,
    src_backend: &Backend,
    dest_backend: &Backend,
    summary: &mut Summary,
    on_prompt: &mut P,
) -> FileOutcome
where
    P: FnMut(CrossPlannedFile, PathMeta) -> Fut,
    Fut: Future<Output = Option<ConflictPromptDecision>>,
{
    // Stat dest once. None = doesn't exist; we just copy.
    let dest_meta = match dest_backend.metadata(&file.dest).await {
        Ok(m) => m,
        Err(e) => {
            summary.errors += 1;
            return FileOutcome::Error {
                src: file.src.clone(),
                dest: file.dest.clone(),
                error: e,
            };
        }
    };
    if let Some(dm) = dest_meta {
        if let Some(reason) = unchanged_reason(
            file.size,
            dm.size,
            file.mtime,
            dm.mtime,
            opts.lookback_days,
        ) {
            summary.skipped += 1;
            return FileOutcome::Skipped {
                src: file.src.clone(),
                dest: file.dest.clone(),
                reason,
            };
        }
        // Decide via the policy. Smart-batch policies map to per-file
        // copy/skip decisions on metadata alone; they work unchanged
        // here. Rename* and Prompt fall through to skip.
        let proceed = match opts.conflict_policy {
            ConflictPolicy::Skip => false,
            ConflictPolicy::Overwrite => true,
            ConflictPolicy::KeepBoth => {
                let renamed = keep_both_path(dest_backend, &file.dest).await;
                return do_copy_one(file, &renamed, src_backend, dest_backend, opts, summary).await;
            }
            ConflictPolicy::OverwriteOlder => {
                file.mtime
                    .zip(dm.mtime)
                    .map(|(s, d)| d < s)
                    .unwrap_or(false)
            }
            ConflictPolicy::ReplaceSmaller => dm.size < file.size,
            ConflictPolicy::ReplaceIfSizeDifferent => dm.size != file.size,
            ConflictPolicy::RenameTarget | ConflictPolicy::RenameOlderTarget => {
                // Cross-mode aside-rename lands in 0.2.5. For now,
                // surface as a conflict so the user sees what
                // happened rather than silently overwriting.
                false
            }
            ConflictPolicy::Prompt => {
                // Park on the resolver hub via the closure. None
                // (cancel) treated as Skip for this file; the outer
                // cancel-check exits the loop next iteration.
                let decision = on_prompt(file.clone(), dm).await;
                match decision {
                    Some(ConflictPromptDecision::Overwrite) => true,
                    Some(ConflictPromptDecision::Skip) | None => false,
                    Some(ConflictPromptDecision::KeepBoth) => {
                        let renamed = keep_both_path(dest_backend, &file.dest).await;
                        return do_copy_one(
                            file,
                            &renamed,
                            src_backend,
                            dest_backend,
                            opts,
                            summary,
                        )
                        .await;
                    }
                    Some(ConflictPromptDecision::CancelJob) => {
                        // The command layer flips the cancel token
                        // alongside resolving — but be defensive: mark
                        // this file a conflict and the outer loop
                        // bails on next iteration when is_cancelled().
                        false
                    }
                }
            }
        };
        if !proceed {
            summary.conflicts += 1;
            return FileOutcome::Conflict {
                src: file.src.clone(),
                dest: file.dest.clone(),
                reason: format!("policy={:?} (cross mode)", opts.conflict_policy),
            };
        }
    }
    do_copy_one(file, &file.dest, src_backend, dest_backend, opts, summary).await
}

/// Read src, write dest. Honors `dry_run`. Errors per file rather
/// than aborting the job.
async fn do_copy_one(
    file: &CrossPlannedFile,
    target: &str,
    src_backend: &Backend,
    dest_backend: &Backend,
    opts: &JobOptions,
    summary: &mut Summary,
) -> FileOutcome {
    if opts.dry_run {
        summary.copied += 1;
        summary.bytes_copied += file.size;
        return FileOutcome::Copied {
            src: file.src.clone(),
            dest: target.to_string(),
            bytes: file.size,
        };
    }
    match src_backend.copy_file(&file.src, dest_backend, target).await {
        Ok(bytes) => {
            summary.copied += 1;
            summary.bytes_copied += bytes;
            FileOutcome::Copied {
                src: file.src.clone(),
                dest: target.to_string(),
                bytes,
            }
        }
        Err(e) => {
            summary.errors += 1;
            FileOutcome::Error {
                src: file.src.clone(),
                dest: target.to_string(),
                error: e,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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

    #[tokio::test]
    async fn local_to_local_round_trip() {
        let src = std::env::temp_dir().join(format!("skiff-cross-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-cross-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("a.txt"), b"hello").unwrap();
        fs::create_dir(src.join("sub")).unwrap();
        fs::write(src.join("sub/b.txt"), b"world!").unwrap();

        let (plan, total) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(plan.len(), 2);
        assert_eq!(total, 5 + 6);

        let s = execute_cross(
            "test",
            plan,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Overwrite,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            |_, _| async { None },
        )
        .await;
        assert_eq!(s.copied, 2);
        assert!(dest.join("a.txt").exists());
        assert!(dest.join("sub/b.txt").exists());

        // Second run with same opts should skip both via unchanged.
        let (plan2, total2) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        let s2 = execute_cross(
            "test2",
            plan2,
            total2,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Overwrite,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            |_, _| async { None },
        )
        .await;
        assert_eq!(s2.skipped, 2);
        assert_eq!(s2.copied, 0);

        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dest);
    }

    #[tokio::test]
    async fn cross_mode_keep_both_picks_a_renamed_sibling() {
        let src = std::env::temp_dir().join(format!("skiff-cross-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-cross-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(src.join("a.txt"), b"new-content").unwrap();
        fs::write(dest.join("a.txt"), b"existing").unwrap();
        let (plan, total) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        execute_cross(
            "test",
            plan,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::KeepBoth,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            |_, _| async { None },
        )
        .await;
        // Original untouched; sibling created.
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"existing");
        assert!(dest.join("a (2).txt").exists());
        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dest);
    }

    #[tokio::test]
    async fn local_to_local_streams_large_file_past_old_inmemory_cap() {
        // The 0.2.0 cap was 256 MB. Use 4 MB for a fast test that
        // proves the streaming path doesn't materialize the whole file.
        let src = std::env::temp_dir().join(format!("skiff-cross-stream-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-cross-stream-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dest).unwrap();
        // 4 MB of zeros — content doesn't matter, just the size.
        let big = vec![0u8; 4 * 1024 * 1024];
        fs::write(src.join("big.bin"), &big).unwrap();

        let (plan, total) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(plan.len(), 1);
        assert_eq!(total, big.len() as u64);

        let s = execute_cross(
            "test",
            plan,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Overwrite,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            |_, _| async { None },
        )
        .await;
        assert_eq!(s.copied, 1);
        assert_eq!(s.errors, 0);
        assert_eq!(
            std::fs::metadata(dest.join("big.bin")).unwrap().len(),
            big.len() as u64
        );
        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dest);
    }

    #[tokio::test]
    async fn cross_mode_prompt_overwrite_decision_overwrites() {
        let src = std::env::temp_dir().join(format!("skiff-cross-prompt-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-cross-prompt-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(src.join("a.txt"), b"new-content").unwrap();
        fs::write(dest.join("a.txt"), b"old-existing-different").unwrap();
        let (plan, total) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        let s = execute_cross(
            "test",
            plan,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Prompt,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            // Always answer "Overwrite".
            |_, _| async { Some(ConflictPromptDecision::Overwrite) },
        )
        .await;
        assert_eq!(s.copied, 1);
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"new-content");
        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dest);
    }

    #[tokio::test]
    async fn cross_mode_prompt_skip_decision_leaves_dest_alone() {
        let src = std::env::temp_dir().join(format!("skiff-cross-prompt-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-cross-prompt-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(src.join("a.txt"), b"new-content").unwrap();
        fs::write(dest.join("a.txt"), b"different-size-existing").unwrap();
        let (plan, total) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        let s = execute_cross(
            "test",
            plan,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Prompt,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            |_, _| async { Some(ConflictPromptDecision::Skip) },
        )
        .await;
        assert_eq!(s.conflicts, 1);
        assert_eq!(s.copied, 0);
        assert_eq!(
            fs::read(dest.join("a.txt")).unwrap(),
            b"different-size-existing"
        );
        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dest);
    }

    #[tokio::test]
    async fn cross_mode_prompt_keep_both_writes_a_renamed_sibling() {
        let src = std::env::temp_dir().join(format!("skiff-cross-prompt-src-{}", uniq()));
        let dest = std::env::temp_dir().join(format!("skiff-cross-prompt-dest-{}", uniq()));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(src.join("a.txt"), b"new").unwrap();
        fs::write(dest.join("a.txt"), b"existing-different").unwrap();
        let (plan, total) = plan_cross(
            &Backend::Local,
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
        )
        .await
        .unwrap();
        execute_cross(
            "test",
            plan,
            total,
            &JobOptions {
                max_size_gb: 1,
                lookback_days: 0,
                conflict_policy: ConflictPolicy::Prompt,
                dry_run: false,
            },
            CancelToken::new(),
            Backend::Local,
            Backend::Local,
            |_| {},
            |_, _| async { Some(ConflictPromptDecision::KeepBoth) },
        )
        .await;
        // Original untouched, sibling created with the new content.
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"existing-different");
        assert_eq!(fs::read(dest.join("a (2).txt")).unwrap(), b"new");
        let _ = fs::remove_dir_all(src);
        let _ = fs::remove_dir_all(dest);
    }

    #[test]
    fn join_dest_emits_forward_slashes() {
        assert_eq!(join_dest("/x", "a/b"), "/x/a/b");
        assert_eq!(join_dest("/x/", "a/b"), "/x/a/b");
        assert_eq!(join_dest("/x", ""), "/x");
    }

    #[test]
    fn unchanged_reason_size_only() {
        assert!(unchanged_reason(100, 100, None, None, 0).is_some());
        assert!(unchanged_reason(100, 200, None, None, 0).is_none());
    }
}
