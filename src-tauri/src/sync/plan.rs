//! Pre-scan logic. Walks `src` (recursively) and produces a flat list of
//! files to consider, plus the total byte count. We do this in a separate
//! pass so we can reject jobs that exceed `max_size_gb` before writing a
//! single byte — same behavior as `cpsync`.

use std::fs;
use std::path::{Path, PathBuf};

/// One file in the plan. The destination is computed by mirroring the
/// `src` -> `dest_root` relative structure, so a sync of
/// `/src/a/b.txt -> /dest/` produces `dest = /dest/a/b.txt`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFile {
    pub src: PathBuf,
    pub dest: PathBuf,
    pub size: u64,
    /// Mtime as unix seconds; `None` if the platform refuses.
    pub mtime: Option<i64>,
}

/// Walk `src` and produce a `(plan, total_bytes)` pair. `dest_root` is
/// where each file's relative path is grafted onto. Symlinks aren't
/// followed — they're skipped silently for now (Phase 4b adds an option).
pub fn plan(src: &Path, dest_root: &Path) -> Result<(Vec<PlannedFile>, u64), String> {
    let mut out = Vec::new();
    let mut total = 0u64;

    let src_meta = fs::symlink_metadata(src)
        .map_err(|e| format!("stat({}): {e}", src.display()))?;

    if src_meta.is_file() {
        // file -> folder: dest is dest_root/<file_name>.
        let name = src
            .file_name()
            .ok_or_else(|| format!("source has no file name: {}", src.display()))?;
        let dest = dest_root.join(name);
        let size = src_meta.len();
        let mtime = src_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        out.push(PlannedFile {
            src: src.to_path_buf(),
            dest,
            size,
            mtime,
        });
        total += size;
        return Ok((out, total));
    }

    if !src_meta.is_dir() {
        return Err(format!("source is neither file nor dir: {}", src.display()));
    }

    // Iterative DFS so we don't blow the stack on deeply nested trees.
    let mut stack: Vec<PathBuf> = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // permission errors etc. — keep going
        };
        for entry in read.flatten() {
            let p = entry.path();
            let md = match fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if md.file_type().is_symlink() {
                continue;
            }
            if md.is_dir() {
                stack.push(p);
                continue;
            }
            // Compute dest relative to the original src root.
            let rel = match p.strip_prefix(src) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let dest = dest_root.join(rel);
            let size = md.len();
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            out.push(PlannedFile {
                src: p,
                dest,
                size,
                mtime,
            });
            total += size;
        }
    }

    Ok((out, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("skiff-plan-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        // /root/a.txt
        File::create(root.join("a.txt"))
            .unwrap()
            .write_all(b"hello")
            .unwrap();
        // /root/sub/b.txt
        fs::create_dir(root.join("sub")).unwrap();
        File::create(root.join("sub/b.txt"))
            .unwrap()
            .write_all(b"world!")
            .unwrap();
        root
    }

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
    fn plans_a_single_file_to_folder() {
        let root = fixture();
        let dest = std::env::temp_dir().join(format!("skiff-plan-dest-{}", uniq()));
        fs::create_dir_all(&dest).unwrap();
        let (out, bytes) = plan(&root.join("a.txt"), &dest).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dest, dest.join("a.txt"));
        assert_eq!(bytes, 5);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(dest);
    }

    #[test]
    fn plans_a_recursive_dir_with_correct_dest_paths() {
        let root = fixture();
        let dest = std::env::temp_dir().join(format!("skiff-plan-dest-{}", uniq()));
        let (out, bytes) = plan(&root, &dest).unwrap();
        assert_eq!(out.len(), 2);
        let dests: Vec<_> = out.iter().map(|p| p.dest.clone()).collect();
        assert!(dests.contains(&dest.join("a.txt")));
        assert!(dests.contains(&dest.join("sub").join("b.txt")));
        assert_eq!(bytes, 5 + 6);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn plan_errors_on_missing_source() {
        let result = plan(
            Path::new("/definitely/not/here/skiff-plan"),
            Path::new("/tmp"),
        );
        assert!(result.is_err());
    }
}
