//! Local filesystem operations. Synchronous — Tauri runs each command on its
//! own worker thread, so we don't pay an async runtime cost. The future remote
//! backends (sftp/ftp/smb) will be `async`; we'll align the shapes via a trait
//! in Phase 2 once we have a second implementation to compare against.

use super::icons::kind_for_path;
use super::types::{Entry, FileKind, FsResult, ListOptions};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Convert a [`SystemTime`] (as returned by `fs::Metadata::modified`) to a unix
/// timestamp in seconds. Returns `None` if conversion would underflow (file
/// times before 1970, or platform reports an error).
fn system_time_to_unix_secs(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// Best-effort permission-bit extractor. Unix gives us the full mode mask.
/// Windows has no equivalent — we return `None` so the UI can hide that
/// column rather than show fake `0o644`s.
fn permission_mode(_metadata: &fs::Metadata) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Some(_metadata.permissions().mode())
    }
    #[cfg(not(unix))]
    {
        None
    }
}

/// Hidden = name starts with `.` on all OSes (Unix convention). On Windows we
/// also honor the FILE_ATTRIBUTE_HIDDEN bit so files marked hidden via Explorer
/// are respected without forcing users to dotfile-rename them.
fn is_hidden(name: &str, _metadata: &fs::Metadata) -> bool {
    if name.starts_with('.') && name != "." && name != ".." {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if _metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
            return true;
        }
    }
    false
}

/// Build an [`Entry`] from a path + metadata pair. We accept metadata as an
/// argument so callers that already called `symlink_metadata` don't pay for a
/// second stat.
fn entry_from_metadata(path: &Path, metadata: &fs::Metadata) -> Entry {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let is_dir = metadata.is_dir();
    let is_symlink = metadata.file_type().is_symlink();

    // Prefer FileKind::Folder/Symlink; only fall back to extension lookup for
    // regular files. Symlinks-to-files keep the link kind so the UI can show
    // the link affordance.
    let kind = if is_dir {
        FileKind::Folder
    } else if is_symlink {
        FileKind::Symlink
    } else {
        let k = kind_for_path(path);
        // Promote "Unknown" to "Binary" only if we know it's not text-y. We
        // currently don't sniff content — leave as Unknown to avoid lying.
        k
    };

    Entry {
        name: name.clone(),
        path: path.to_string_lossy().into_owned(),
        kind,
        size: if is_dir { 0 } else { metadata.len() },
        mtime: metadata.modified().ok().and_then(system_time_to_unix_secs),
        is_dir,
        is_symlink,
        is_hidden: is_hidden(&name, metadata),
        mode: permission_mode(metadata),
    }
}

/// List the immediate children of `path`. Symlinks are reported as symlinks
/// (we use `symlink_metadata`) — chasing them recursively is the caller's job.
/// Hidden entries are filtered per `opts.show_hidden`.
///
/// Errors are flattened to strings on the way out so the frontend gets a tidy
/// message via `invoke().catch(...)`.
pub fn list_dir(path: &Path, opts: ListOptions) -> FsResult<Vec<Entry>> {
    let mut entries: Vec<Entry> = Vec::new();
    let read = fs::read_dir(path).map_err(|e| format!("read_dir({}): {e}", path.display()))?;
    for dirent in read {
        let dirent = match dirent {
            Ok(d) => d,
            // Skip individual errored entries (e.g. permissions on one file)
            // rather than failing the whole listing — that's the behavior
            // every native file browser ships with.
            Err(_) => continue,
        };
        let entry_path = dirent.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let entry = entry_from_metadata(&entry_path, &metadata);
        if !opts.show_hidden && entry.is_hidden {
            continue;
        }
        entries.push(entry);
    }
    Ok(entries)
}

/// Single-path stat, surfacing the same shape as a [`list_dir`] row. Useful
/// for the path bar / breadcrumb to verify the destination exists before
/// navigating.
pub fn stat(path: &Path) -> FsResult<Entry> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("stat({}): {e}", path.display()))?;
    Ok(entry_from_metadata(path, &metadata))
}

/// Create a directory and any missing parents. No-op if it already exists as
/// a directory; errors if the path exists as a file.
pub fn mkdir(path: &Path) -> FsResult<()> {
    if path.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|e| format!("mkdir({}): {e}", path.display()))
}

/// Rename / move within the same filesystem. For cross-device moves the
/// caller should fall back to copy + remove (the future Skiffsync engine
/// handles that path; we keep this primitive cheap and predictable).
pub fn rename(from: &Path, to: &Path) -> FsResult<()> {
    fs::rename(from, to).map_err(|e| format!("rename({} -> {}): {e}", from.display(), to.display()))
}

/// Remove a file, an empty dir, or a non-empty dir recursively. We pick the
/// right syscall by stat'ing first so that callers don't have to.
pub fn remove(path: &Path) -> FsResult<()> {
    let md = fs::symlink_metadata(path).map_err(|e| format!("stat({}): {e}", path.display()))?;
    if md.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("remove_dir_all({}): {e}", path.display()))
    } else {
        fs::remove_file(path).map_err(|e| format!("remove_file({}): {e}", path.display()))
    }
}

/// Copy a single file. Recursive folder copies will live in the Skiffsync
/// engine (Phase 4), which has progress reporting + skip-if-unchanged; this
/// primitive is intentionally narrow.
pub fn copy_file(from: &Path, to: &Path) -> FsResult<u64> {
    fs::copy(from, to).map_err(|e| format!("copy({} -> {}): {e}", from.display(), to.display()))
}

/// Resolve a possibly-relative path against the current working directory, and
/// then canonicalize away any `..` components. We use `canonicalize` rather
/// than `absolute` because it also resolves symlinks — callers that need to
/// surface a symlink target separately should `symlink_metadata` first.
pub fn canonicalize(path: &Path) -> FsResult<PathBuf> {
    fs::canonicalize(path).map_err(|e| format!("canonicalize({}): {e}", path.display()))
}

/// Returns the user's home directory, or an error if the platform refuses
/// (extremely rare — typically only happens in stripped CI sandboxes).
pub fn home_dir() -> FsResult<PathBuf> {
    dirs::home_dir().ok_or_else(|| "home dir not available on this platform".to_string())
}

// ---------- Preview helpers (Phase 1.5) ----------
//
// These power the right-side preview pane. They cap how much data we'll
// read so a stray click on a 10 GB log file doesn't pin the UI thread.

/// Read a file as UTF-8 text, capped at `max_bytes`. We intentionally lossy-
/// decode so a non-UTF8 file (e.g. a Latin-1 readme) doesn't error — the
/// preview pane shows replacement chars rather than nothing.
pub fn read_file_text(path: &Path, max_bytes: u64) -> FsResult<String> {
    let md = fs::metadata(path).map_err(|e| format!("stat({}): {e}", path.display()))?;
    if md.is_dir() {
        return Err(format!("not a file: {}", path.display()));
    }
    let len = std::cmp::min(md.len(), max_bytes);
    let mut f = fs::File::open(path).map_err(|e| format!("open({}): {e}", path.display()))?;
    use std::io::Read;
    let mut buf = vec![0u8; len as usize];
    f.read_exact(&mut buf)
        .map_err(|e| format!("read({}): {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Read a file as base64 — used for inline image previews. We refuse anything
/// over `max_bytes` instead of silently truncating (a half-image is worse
/// than no image).
pub fn read_file_base64(path: &Path, max_bytes: u64) -> FsResult<String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine as _;
    let md = fs::metadata(path).map_err(|e| format!("stat({}): {e}", path.display()))?;
    if md.is_dir() {
        return Err(format!("not a file: {}", path.display()));
    }
    if md.len() > max_bytes {
        return Err(format!(
            "file too large for preview: {} bytes (limit {})",
            md.len(),
            max_bytes
        ));
    }
    let bytes = fs::read(path).map_err(|e| format!("read({}): {e}", path.display()))?;
    Ok(B64.encode(bytes))
}

/// Recursive directory summary — total entries + total bytes. Capped at
/// `max_entries` so a click on `/` doesn't lock up; if we hit the cap we
/// flip `truncated = true` and the UI shows a "≥" prefix.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSummary {
    pub entries: u64,
    pub total_size: u64,
    pub truncated: bool,
}

pub fn dir_summary(path: &Path, max_entries: usize) -> FsResult<DirSummary> {
    let mut entries: u64 = 0;
    let mut total_size: u64 = 0;
    // Iterative DFS so a deeply-nested tree doesn't blow the stack.
    let mut stack: Vec<PathBuf> = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            // Skip unreadable subdirs (permissions etc.) rather than failing
            // the whole scan — same behavior as the listing fn.
            Err(_) => continue,
        };
        for d in read {
            if entries as usize >= max_entries {
                return Ok(DirSummary {
                    entries,
                    total_size,
                    truncated: true,
                });
            }
            let d = match d {
                Ok(d) => d,
                Err(_) => continue,
            };
            entries += 1;
            let p = d.path();
            let md = match fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if md.is_dir() && !md.file_type().is_symlink() {
                stack.push(p);
            } else {
                total_size += md.len();
            }
        }
    }
    Ok(DirSummary {
        entries,
        total_size,
        truncated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    /// Build an isolated temp dir with a few entries and return its path. Each
    /// test gets its own dir under the system temp so they can run in parallel.
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("skiff-files-test-{}", uniq()));
        fs::create_dir_all(&root).unwrap();
        // visible file
        let f1 = root.join("hello.md");
        File::create(&f1).unwrap().write_all(b"# hi\n").unwrap();
        // hidden dotfile
        File::create(root.join(".hidden")).unwrap();
        // visible nested dir
        fs::create_dir(root.join("sub")).unwrap();
        root
    }

    /// Cheap unique-id generator for fixture dirs. Tests run in parallel so
    /// nanos alone occasionally collide — combine with a process-local
    /// monotonic counter to make collisions impossible.
    fn uniq() -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{t}-{n}")
    }

    #[test]
    fn list_dir_returns_visible_entries_by_default() {
        let root = fixture();
        let entries = list_dir(&root, ListOptions::default()).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"hello.md"), "got {names:?}");
        assert!(names.contains(&"sub"), "got {names:?}");
        assert!(!names.contains(&".hidden"), "hidden leaked: {names:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_dir_shows_hidden_when_requested() {
        let root = fixture();
        let entries = list_dir(
            &root,
            ListOptions {
                show_hidden: true,
            },
        )
        .unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&".hidden"), "got {names:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stat_classifies_directory() {
        let root = fixture();
        let info = stat(&root).unwrap();
        assert!(info.is_dir);
        assert_eq!(info.kind, FileKind::Folder);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stat_classifies_markdown_file() {
        let root = fixture();
        let f = root.join("hello.md");
        let info = stat(&f).unwrap();
        assert!(!info.is_dir);
        assert_eq!(info.kind, FileKind::Markdown);
        assert!(info.size > 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mkdir_is_idempotent_on_existing_dir() {
        let root = fixture();
        let nested = root.join("a/b/c");
        mkdir(&nested).unwrap();
        // second call must succeed
        mkdir(&nested).unwrap();
        assert!(nested.is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_moves_a_file_within_dir() {
        let root = fixture();
        let from = root.join("hello.md");
        let to = root.join("hi.md");
        rename(&from, &to).unwrap();
        assert!(!from.exists() && to.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_handles_files_and_dirs() {
        let root = fixture();
        remove(&root.join("hello.md")).unwrap();
        remove(&root.join("sub")).unwrap();
        let entries = list_dir(&root, ListOptions::default()).unwrap();
        assert!(entries.is_empty(), "got {entries:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_file_duplicates_contents() {
        let root = fixture();
        let from = root.join("hello.md");
        let to = root.join("hello-copy.md");
        let bytes = copy_file(&from, &to).unwrap();
        assert!(bytes > 0);
        assert!(to.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_dir_errors_on_missing_path() {
        let result = list_dir(
            Path::new("/definitely/not/a/real/path/skiff-files"),
            ListOptions::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn read_file_text_returns_contents() {
        let root = fixture();
        let txt = read_file_text(&root.join("hello.md"), 1024).unwrap();
        assert!(txt.contains("# hi"), "got {txt:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_file_text_caps_at_max_bytes() {
        let root = fixture();
        let p = root.join("big.txt");
        fs::write(&p, "abcdefghijklmnop").unwrap(); // 16 bytes
        let txt = read_file_text(&p, 5).unwrap();
        assert_eq!(txt.len(), 5);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_file_base64_round_trips() {
        use base64::engine::general_purpose::STANDARD as B64;
        use base64::Engine as _;
        let root = fixture();
        let b64 = read_file_base64(&root.join("hello.md"), 1024).unwrap();
        let decoded = B64.decode(b64).unwrap();
        assert_eq!(decoded, b"# hi\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_file_base64_refuses_oversize() {
        let root = fixture();
        let p = root.join("big.bin");
        fs::write(&p, vec![0u8; 4096]).unwrap();
        let result = read_file_base64(&p, 100);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_file_base64_rejects_directory() {
        let root = fixture();
        assert!(read_file_base64(&root, 1024).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dir_summary_counts_entries_and_size() {
        let root = fixture();
        // hello.md (5 bytes) + .hidden (0 bytes) + sub/ (counted as entry, 0 size)
        let s = dir_summary(&root, 1000).unwrap();
        assert_eq!(s.entries, 3);
        assert!(s.total_size >= 5);
        assert!(!s.truncated);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dir_summary_truncates_at_cap() {
        let root = fixture();
        // Cap at 1; with 3 entries we should see truncated=true.
        let s = dir_summary(&root, 1).unwrap();
        assert!(s.truncated);
        assert!(s.entries <= 3);
        let _ = fs::remove_dir_all(root);
    }
}
