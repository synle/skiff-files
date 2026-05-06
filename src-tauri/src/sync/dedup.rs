//! `dedup` — find duplicates by md5+size, move extras to `_recycleBin/`.
//!
//! Mirrors the bash `dedup` from the user's `bash-file-utils.profile.bash`.
//! Two-pass for efficiency:
//!   1. Walk the tree. Group files by exact size — files with no peer at
//!      the same size CANNOT be duplicates (md5 short-circuit), so we
//!      skip them outright.
//!   2. For every multi-file size group, MD5 each file. Within an
//!      md5-equal cluster, keep the first one we encountered; move every
//!      other into `<root>/_recycleBin/<original-relative-path>`.
//!
//! Symlinks are skipped. `_recycleBin/` itself is excluded from the walk
//! so re-running dedup is idempotent.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// What the UI shows after a run. The `recycle_bin` field is the
/// directory we moved duplicates into so the user can review / undo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DedupSummary {
    pub scanned: u64,
    pub duplicates: u64,
    pub bytes_freed: u64,
    pub recycle_bin: String,
}

const RECYCLE_DIR: &str = "_recycleBin";
const HASH_BUF: usize = 64 * 1024;

/// Stream-hash a file. We chunk so a 10 GB ISO doesn't live in memory.
fn md5_of(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path)
        .map_err(|e| format!("open({}): {e}", path.display()))?;
    let mut ctx = md5::Context::new();
    let mut buf = [0u8; HASH_BUF];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("read({}): {e}", path.display()))?;
        if n == 0 {
            break;
        }
        ctx.consume(&buf[..n]);
    }
    Ok(format!("{:x}", ctx.compute()))
}

/// Walk `root` (recursively) and emit `(path, size)` for every regular
/// file outside of the recycle bin. Symlinks are skipped to avoid loops.
fn walk(root: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = Vec::new();
    let recycle = root.join(RECYCLE_DIR);
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if dir == recycle {
            continue;
        }
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for d in read.flatten() {
            let p = d.path();
            let md = match fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if md.file_type().is_symlink() {
                continue;
            }
            if md.is_dir() {
                stack.push(p);
            } else {
                out.push((p, md.len()));
            }
        }
    }
    out
}

/// Public entry. Walks `root`, identifies duplicates, moves extras into
/// `<root>/_recycleBin/`, returns a summary. Idempotent — running twice
/// is a no-op (everything that would have moved is already in the bin,
/// which we exclude from the walk).
pub fn dedup(root: &Path) -> Result<DedupSummary, String> {
    let recycle = root.join(RECYCLE_DIR);

    // Pass 1: bucket by size.
    let files = walk(root);
    let scanned = files.len() as u64;
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for (p, s) in files {
        by_size.entry(s).or_default().push(p);
    }

    // Pass 2: hash + move duplicates.
    let mut duplicates: u64 = 0;
    let mut bytes_freed: u64 = 0;
    for (size, group) in by_size.into_iter() {
        if group.len() < 2 {
            continue;
        }
        // Hash each file; group by md5.
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for p in group {
            match md5_of(&p) {
                Ok(h) => by_hash.entry(h).or_default().push(p),
                // Skip files we couldn't hash (permissions, deleted between
                // walk and hash, etc.) — they don't get treated as dupes.
                Err(_) => continue,
            }
        }
        for (_h, paths) in by_hash {
            if paths.len() < 2 {
                continue;
            }
            // Keep the first; move the rest. "First" is whatever order
            // walk() produced, which is depth-first by directory entry
            // order — close enough to deterministic for this use case.
            let mut iter = paths.into_iter();
            let _keep = iter.next();
            for victim in iter {
                let rel = match victim.strip_prefix(root) {
                    Ok(r) => r.to_path_buf(),
                    Err(_) => continue,
                };
                let dest = recycle.join(&rel);
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if fs::rename(&victim, &dest).is_err() {
                    // Cross-device rename can fail with EXDEV; fall back
                    // to copy + remove. Same trick `cpsync` uses.
                    if fs::copy(&victim, &dest).is_ok() {
                        let _ = fs::remove_file(&victim);
                    } else {
                        continue;
                    }
                }
                duplicates += 1;
                bytes_freed += size;
            }
        }
    }

    Ok(DedupSummary {
        scanned,
        duplicates,
        bytes_freed,
        recycle_bin: recycle.to_string_lossy().into_owned(),
    })
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

    fn write(p: &Path, body: &[u8]) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        File::create(p).unwrap().write_all(body).unwrap();
    }

    #[test]
    fn moves_byte_identical_duplicates_to_recycle_bin() {
        let root = std::env::temp_dir().join(format!("skiff-dedup-{}", uniq()));
        write(&root.join("a.txt"), b"hello");
        write(&root.join("sub/b.txt"), b"hello"); // same content
        write(&root.join("c.txt"), b"different"); // singleton

        let s = dedup(&root).unwrap();
        assert_eq!(s.scanned, 3);
        assert_eq!(s.duplicates, 1);
        assert_eq!(s.bytes_freed, 5);
        // One of the duplicates should land in the recycle bin under its
        // relative path. We don't assert which one — pick whichever moved.
        let recycle = root.join(RECYCLE_DIR);
        assert!(recycle.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn skips_files_with_unique_size() {
        let root = std::env::temp_dir().join(format!("skiff-dedup-{}", uniq()));
        write(&root.join("a.txt"), b"abc"); // 3 bytes
        write(&root.join("b.txt"), b"defg"); // 4 bytes
        let s = dedup(&root).unwrap();
        assert_eq!(s.scanned, 2);
        assert_eq!(s.duplicates, 0);
        assert!(!root.join(RECYCLE_DIR).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn second_run_is_idempotent() {
        let root = std::env::temp_dir().join(format!("skiff-dedup-{}", uniq()));
        write(&root.join("a.txt"), b"same");
        write(&root.join("b.txt"), b"same");
        let s1 = dedup(&root).unwrap();
        let s2 = dedup(&root).unwrap();
        assert_eq!(s1.duplicates, 1);
        assert_eq!(s2.duplicates, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn distinguishes_same_size_different_content() {
        let root = std::env::temp_dir().join(format!("skiff-dedup-{}", uniq()));
        write(&root.join("a.txt"), b"hello"); // 5 bytes
        write(&root.join("b.txt"), b"world"); // 5 bytes, different content
        let s = dedup(&root).unwrap();
        assert_eq!(s.duplicates, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn md5_of_round_trips_against_known_value() {
        let root = std::env::temp_dir().join(format!("skiff-md5-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        let p = root.join("x.txt");
        File::create(&p).unwrap().write_all(b"abc").unwrap();
        // md5("abc") = 900150983cd24fb0d6963f7d28e17f72
        assert_eq!(md5_of(&p).unwrap(), "900150983cd24fb0d6963f7d28e17f72");
        let _ = fs::remove_dir_all(root);
    }
}
