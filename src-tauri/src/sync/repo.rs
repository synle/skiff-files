//! `cprepo` — sync a git repo to dest using only tracked files.
//!
//! Mirrors the bash `cprepo` from `bash-file-utils.profile.bash`. We
//! shell out to `git ls-files` rather than embedding a git library —
//! the user's machine has git, the answers are identical, and the
//! cprepo flow is fundamentally a project-level convenience that
//! doesn't need to work without git installed.
//!
//! The list of tracked files is fed straight into the existing planner's
//! shape so the executor + conflict policies + dry-run all work
//! unchanged.

use crate::sync::plan::PlannedFile;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;

/// Build a plan from `git ls-files` output. Returns `(plan, total_bytes)`
/// just like `plan::plan`, so the existing executor can run it. Bails
/// early if `src` isn't a git work tree.
pub fn plan_repo(src: &Path, dest_root: &Path) -> Result<(Vec<PlannedFile>, u64), String> {
    if !src.is_dir() {
        return Err(format!("cprepo: src must be a directory: {}", src.display()));
    }

    // `git -C <src> ls-files -z` emits NUL-separated tracked paths,
    // relative to the repo root. NUL avoids the rename/whitespace traps
    // that newline-delimited output has.
    let output = Command::new("git")
        .arg("-C")
        .arg(src)
        .arg("ls-files")
        .arg("-z")
        .output()
        .map_err(|e| format!("git ls-files failed to run (is git installed?): {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(format!(
            "git ls-files: {} ({})",
            output.status,
            stderr.trim()
        ));
    }

    let mut files = Vec::new();
    let mut total = 0u64;
    for chunk in output.stdout.split(|b| *b == 0) {
        if chunk.is_empty() {
            continue;
        }
        let rel = match std::str::from_utf8(chunk) {
            Ok(s) => s,
            Err(_) => continue, // git returns valid UTF-8 unless core.quotePath is on
        };
        let absolute = src.join(rel);
        let md = match fs::symlink_metadata(&absolute) {
            Ok(m) => m,
            // git tracks but the file's missing — likely a sparse checkout.
            // Skip rather than fail the whole job.
            Err(_) => continue,
        };
        if md.file_type().is_symlink() || md.is_dir() {
            continue;
        }
        let size = md.len();
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        files.push(PlannedFile {
            src: absolute,
            dest: dest_root.join(rel),
            size,
            mtime,
        });
        total += size;
    }
    Ok((files, total))
}

#[cfg(test)]
mod tests {
    use super::*;
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

    /// Create a fresh git repo with two tracked files + one untracked.
    /// Returns the repo root so the caller can clean up.
    ///
    /// Skips the test entirely on machines where git isn't on PATH —
    /// CI runners always have git, but a developer's stripped sandbox
    /// might not.
    fn fresh_repo() -> Option<PathBuf> {
        if Command::new("git").arg("--version").output().is_err() {
            return None;
        }
        let root = std::env::temp_dir().join(format!("skiff-cprepo-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("init")
            .arg("-q")
            .status()
            .ok()?;
        // Configure identity inside the repo so the commit doesn't need
        // a global gitconfig.
        for (k, v) in [("user.email", "test@example.com"), ("user.name", "test")] {
            Command::new("git")
                .arg("-C")
                .arg(&root)
                .args(["config", k, v])
                .status()
                .ok()?;
        }
        // Tracked file at top level.
        File::create(root.join("a.txt"))
            .unwrap()
            .write_all(b"alpha")
            .unwrap();
        // Tracked file in a subdir.
        fs::create_dir(root.join("sub")).unwrap();
        File::create(root.join("sub/b.txt"))
            .unwrap()
            .write_all(b"bravo")
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["add", "."])
            .status()
            .ok()?;
        Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["commit", "-q", "-m", "init"])
            .status()
            .ok()?;
        // Untracked file — `cprepo` should skip this.
        File::create(root.join("untracked.txt"))
            .unwrap()
            .write_all(b"ignored")
            .unwrap();
        Some(root)
    }

    #[test]
    fn plan_repo_returns_only_tracked_files() {
        let Some(root) = fresh_repo() else {
            eprintln!("skipping: git not available");
            return;
        };
        let dest = std::env::temp_dir().join(format!("skiff-cprepo-dest-{}", uniq()));
        let (files, bytes) = plan_repo(&root, &dest).unwrap();
        let names: Vec<_> = files
            .iter()
            .map(|p| {
                p.src
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert!(names.contains(&"a.txt".into()), "got {names:?}");
        assert!(
            names.iter().any(|n| n == "sub/b.txt" || n == "sub\\b.txt"),
            "got {names:?}"
        );
        assert!(
            !names.iter().any(|n| n.contains("untracked")),
            "untracked leaked: {names:?}"
        );
        assert_eq!(bytes, 5 + 5);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn plan_repo_errors_when_src_not_a_git_repo() {
        let root = std::env::temp_dir().join(format!("skiff-not-a-repo-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        // Plain dir — `git ls-files` will error.
        let result = plan_repo(&root, Path::new("/tmp/never-used"));
        // Either git is missing (returned early) or git ls-files fails.
        // Both are fine; we just want NOT-Ok.
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
