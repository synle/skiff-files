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
}
