//! Tauri command surface. Each function here is a thin adapter: it accepts
//! string paths from the frontend, hands them to the [`crate::fs`] module, and
//! returns either a serializable struct or a string error message.
//!
//! Commands live here (rather than `lib.rs`) so the registration list in
//! `lib.rs` stays a one-liner per command — easier to scan and reorder.

use crate::fs::local::{self, DirSummary};
use crate::fs::ftp::{FtpClient, FtpConfig};
use crate::fs::registry::{Connection, ConnectionInfo, ConnectionKind, Registry};
use crate::fs::sftp::{SftpClient, SftpConfig};
use crate::fs::ssh_config::{load_ssh_config_hosts, SshConfigHost};
use crate::fs::types::{Entry, FsResult, ListOptions};
use crate::sync::backend::Backend;
use crate::sync::cross_engine::{execute_cross, plan_cross};
use crate::sync::dedup::{dedup as run_dedup, DedupSummary};
use crate::sync::engine::{execute as execute_sync, CancelToken};
use crate::sync::plan::plan as plan_sync;
use crate::sync::plan::PlannedFile;
use crate::sync::registry::JobRegistry;
use crate::sync::repo::plan_repo;
use crate::sync::resolver::ResolverHub;
use crate::sync::stamp::cpstamp;
use crate::sync::types::{
    ConflictPrompt, ConflictPromptDecision, JobInfo, JobOptions, JobState, Summary,
};
use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, State};
use uuid::Uuid;

/// Hard cap for inline image previews. Anything bigger should open in an
/// external viewer rather than blow up our IPC channel. 16 MB is enough for
/// 24 MP JPEGs and shrunken RAW conversions.
const IMAGE_PREVIEW_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Hard cap for text previews — Phase 1.5 only renders the head. The
/// "show all" link in the preview pane will open in an external editor.
const TEXT_PREVIEW_MAX_BYTES: u64 = 256 * 1024;

/// Hard cap for the recursive directory scan that powers the folder
/// summary. 250k matches the ~10 second sweet spot on a SATA SSD; tweak
/// as we get real numbers.
const DIR_SCAN_MAX_ENTRIES: usize = 250_000;

/// Versioning is sourced from `tauri.conf.json` via `build.rs`. Returning a
/// `&'static str` avoids a heap allocation per call.
#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("APP_VERSION")
}

/// Returns the user's home directory as a string. The frontend uses this as
/// the default landing path on first launch and as the target of a "Home"
/// favorite.
#[tauri::command]
pub fn fs_home_dir() -> FsResult<String> {
    Ok(local::home_dir()?.to_string_lossy().into_owned())
}

/// Lists immediate children of `path`. Hidden entries are filtered server-side
/// per `options.show_hidden` so the frontend can stay dumb about platform
/// hidden-flag semantics (Unix dotfile vs Windows attribute).
#[tauri::command]
pub fn fs_list_dir(path: String, options: Option<ListOptions>) -> FsResult<Vec<Entry>> {
    local::list_dir(Path::new(&path), options.unwrap_or_default())
}

/// Stat a single path. Used to validate the destination of a path-bar input
/// before we navigate, and to feed the file properties dialog.
#[tauri::command]
pub fn fs_stat(path: String) -> FsResult<Entry> {
    local::stat(Path::new(&path))
}

/// Create a directory (recursive). Idempotent on existing dirs.
#[tauri::command]
pub fn fs_mkdir(path: String) -> FsResult<()> {
    local::mkdir(Path::new(&path))
}

/// Rename / same-FS move. The frontend names the param `from` / `to` because
/// `src` / `dest` collide with React DOM attributes.
#[tauri::command]
pub fn fs_rename(from: String, to: String) -> FsResult<()> {
    local::rename(Path::new(&from), Path::new(&to))
}

/// Permanently delete a file or directory (recursive for dirs). Should
/// only be called from a confirmation flow — the soft-delete path is
/// `fs_trash` below, which is what the Browser's Delete keybind binds
/// to by default.
#[tauri::command]
pub fn fs_remove(path: String) -> FsResult<()> {
    local::remove(Path::new(&path))
}

/// Send a single path (file or directory) to the OS trash via the
/// `trash` crate. Cross-platform: macOS Trash, Windows Recycle Bin,
/// Linux freedesktop.org Trash. Errors are surfaced as strings.
#[tauri::command]
pub fn fs_trash(path: String) -> FsResult<()> {
    trash::delete(&path).map_err(|e| format!("trash({path}): {e}"))
}

/// Reveal a path in the OS file manager (with the entry highlighted
/// when the platform supports it). Uses the platform-native command
/// rather than the cross-platform `open` crate because every native
/// file manager has a different "highlight this child" syntax — and
/// using the OS shell tool keeps us out of the GUI integration
/// rabbit hole.
#[tauri::command]
pub fn fs_reveal_in_os(path: String) -> FsResult<()> {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    {
        // -R reveals the file (selects it inside the parent folder).
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open -R {path}: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        // explorer /select,<path> highlights the entry inside its
        // parent folder.
        Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| format!("explorer /select {path}: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // No standardized "select-this-child" verb on Linux — open
        // the parent dir via xdg-open. Falls back to opening the
        // path itself if there's no parent (e.g. root).
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from(&path));
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("xdg-open {}: {e}", parent.display()))?;
        return Ok(());
    }
    // The compiler should have proven all three branches above are
    // exhaustive on supported platforms, but cover the unreachable
    // case so downstream builds for, say, BSD don't fail to compile.
    #[allow(unreachable_code)]
    Err(format!("reveal_in_os: unsupported platform for {path}"))
}

/// Open a path with the OS's default application. Uses the `open`
/// crate so we don't have to write per-platform shell commands —
/// it dispatches to `open` / `xdg-open` / `start` internally.
#[tauri::command]
pub fn fs_open_with_default(path: String) -> FsResult<()> {
    open::that(&path).map_err(|e| format!("open {path}: {e}"))
}

/// Open the OS's default terminal at `path`. The `path` should be a
/// directory (the context-menu hides this action for files); falling
/// through to a file's parent isn't useful since most users invoke
/// this on a folder anyway.
///
/// Per-OS dispatch: macOS → `open -a Terminal`, Windows → `wt -d`
/// (Windows Terminal) with a `cmd` fallback, Linux → walks a small
/// list of common terminal emulators (gnome-terminal / konsole /
/// xterm / x-terminal-emulator).
#[tauri::command]
pub fn fs_open_in_terminal(path: String) -> FsResult<()> {
    use std::process::Command;
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("open_in_terminal: {path} is not a directory"));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open -a Terminal {path}: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        // Windows Terminal first; falls back to cmd if `wt` isn't
        // installed (older Windows 10 builds + Server SKUs).
        if Command::new("wt")
            .arg("-d")
            .arg(&path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        Command::new("cmd")
            .args(["/C", "start", "", "cmd", "/K"])
            .arg(format!("cd /d \"{path}\""))
            .spawn()
            .map_err(|e| format!("cmd start {path}: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Try the Debian alternatives meta-binary first; fall through
        // to whatever DE-specific terminal is installed. Ordering
        // matches what most "open terminal here" Nautilus/Dolphin
        // extensions probe for.
        let candidates: &[(&str, &[&str])] = &[
            ("x-terminal-emulator", &["--working-directory"]),
            ("gnome-terminal", &["--working-directory"]),
            ("konsole", &["--workdir"]),
            ("xfce4-terminal", &["--working-directory"]),
            ("alacritty", &["--working-directory"]),
            ("kitty", &["-d"]),
            ("xterm", &["-e", "bash", "-c"]),
        ];
        for (bin, flags) in candidates {
            let mut cmd = Command::new(bin);
            if *bin == "xterm" {
                // xterm has no `cwd` flag — wrap in `cd … && bash`.
                cmd.arg("-e").arg("bash").arg("-c").arg(format!(
                    "cd '{}' && exec bash",
                    path.replace('\'', "'\\''")
                ));
            } else {
                for f in flags.iter() {
                    cmd.arg(f);
                }
                cmd.arg(&path);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(format!(
            "open_in_terminal: no supported terminal emulator found"
        ));
    }
    #[allow(unreachable_code)]
    Err(format!("open_in_terminal: unsupported platform for {path}"))
}

/// Extract a zip archive into `dest_dir`. Creates `dest_dir` if it
/// doesn't exist; errors if a file already exists at that path. Used
/// by the right-click "Extract here" action. Best-effort against
/// path-traversal attacks (entries with absolute paths or `..`
/// components are skipped).
#[tauri::command]
pub fn fs_extract_zip(
    zip_path: String,
    dest_dir: String,
) -> FsResult<()> {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};

    let dest = Path::new(&dest_dir);
    if dest.exists() && !dest.is_dir() {
        return Err(format!("not a directory: {dest_dir}"));
    }
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("mkdir({dest_dir}): {e}"))?;
    let file = File::open(&zip_path)
        .map_err(|e| format!("open({zip_path}): {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("read zip({zip_path}): {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;
        let raw_name = entry.name().to_string();
        // Path-traversal guard. Paths inside the zip should be
        // relative; anything trying to escape `dest_dir` gets
        // skipped silently.
        let rel = PathBuf::from(&raw_name);
        if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            continue;
        }
        let target = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("mkdir({}): {e}", target.display()))?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir parent: {e}"))?;
            }
            let mut out = File::create(&target)
                .map_err(|e| format!("create({}): {e}", target.display()))?;
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = entry
                    .read(&mut buf)
                    .map_err(|e| format!("read zip entry: {e}"))?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n])
                    .map_err(|e| format!("write({}): {e}", target.display()))?;
            }
        }
    }
    Ok(())
}

/// Entry inside a zip archive. Used by the in-app archive viewer
/// (right-click → "View contents"). `size` is uncompressed bytes.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

/// Detect archive format from path extension. Returns one of
/// "zip" / "tar" / "tar.gz" / "7z" / "" (unrecognized).
fn archive_format(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        "tar.gz"
    } else if lower.ends_with(".tar") {
        "tar"
    } else if lower.ends_with(".zip") {
        "zip"
    } else if lower.ends_with(".7z") {
        "7z"
    } else {
        ""
    }
}

/// List the contents of an archive (zip / tar / tar.gz). Powers the
/// archive viewer dialog. Zip reads the central directory only so
/// multi-GB archives open instantly; tar walks the whole stream
/// since the format doesn't carry an index.
#[tauri::command]
pub fn fs_archive_list(path: String) -> FsResult<Vec<ArchiveEntry>> {
    use std::fs::File;
    match archive_format(&path) {
        "zip" => {
            let file = File::open(&path).map_err(|e| format!("open({path}): {e}"))?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("read zip({path}): {e}"))?;
            let mut out = Vec::with_capacity(archive.len());
            for i in 0..archive.len() {
                let entry = archive
                    .by_index(i)
                    .map_err(|e| format!("zip entry {i}: {e}"))?;
                out.push(ArchiveEntry {
                    name: entry.name().to_string(),
                    size: entry.size(),
                    is_dir: entry.is_dir(),
                });
            }
            Ok(out)
        }
        "tar" => {
            let file = File::open(&path).map_err(|e| format!("open({path}): {e}"))?;
            list_tar(Box::new(file))
        }
        "tar.gz" => {
            let file = File::open(&path).map_err(|e| format!("open({path}): {e}"))?;
            list_tar(Box::new(flate2::read::GzDecoder::new(file)))
        }
        "7z" => {
            let file = File::open(&path).map_err(|e| format!("open({path}): {e}"))?;
            let len = file
                .metadata()
                .map_err(|e| format!("metadata({path}): {e}"))?
                .len();
            let reader = sevenz_rust::SevenZReader::new(
                file,
                len,
                sevenz_rust::Password::empty(),
            )
            .map_err(|e| format!("read 7z({path}): {e}"))?;
            let mut out = Vec::with_capacity(reader.archive().files.len());
            for entry in &reader.archive().files {
                out.push(ArchiveEntry {
                    name: entry.name().to_string(),
                    size: entry.size(),
                    is_dir: entry.is_directory(),
                });
            }
            Ok(out)
        }
        _ => Err(format!("unsupported archive format: {path}")),
    }
}

/// Walk a tar stream and collect entry metadata. Shared by both
/// plain `.tar` and gzipped `.tar.gz`. The stream is read end-to-end
/// since tar doesn't carry a central directory.
fn list_tar(reader: Box<dyn std::io::Read>) -> FsResult<Vec<ArchiveEntry>> {
    let mut archive = tar::Archive::new(reader);
    let mut out = Vec::new();
    let entries = archive
        .entries()
        .map_err(|e| format!("read tar: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("tar entry: {e}"))?;
        let header = entry.header();
        let path_bytes = entry
            .path_bytes();
        let name = String::from_utf8_lossy(&path_bytes).into_owned();
        let size = header.size().unwrap_or(0);
        let is_dir = header.entry_type().is_dir();
        out.push(ArchiveEntry { name, size, is_dir });
    }
    Ok(out)
}

/// Extract a single entry from an archive (zip / tar / tar.gz) to
/// `dest_path`. Errors if dest_path already exists. Path-traversal
/// guard rejects absolute paths and `..` components. Tar variants
/// walk the stream until they find the named entry — slower than
/// zip's by_name lookup but matches the format's read pattern.
#[tauri::command]
pub fn fs_archive_extract_one(
    zip_path: String,
    entry_name: String,
    dest_path: String,
) -> FsResult<()> {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};

    let dest = Path::new(&dest_path);
    if dest.exists() {
        return Err(format!("destination exists: {dest_path}"));
    }
    let rel = PathBuf::from(&entry_name);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("entry name traverses parent directories".to_string());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    }
    match archive_format(&zip_path) {
        "zip" => {
            let file =
                File::open(&zip_path).map_err(|e| format!("open({zip_path}): {e}"))?;
            let mut archive = zip::ZipArchive::new(file)
                .map_err(|e| format!("read zip({zip_path}): {e}"))?;
            let mut entry = archive
                .by_name(&entry_name)
                .map_err(|e| format!("entry({entry_name}): {e}"))?;
            let mut out = File::create(&dest_path)
                .map_err(|e| format!("create({dest_path}): {e}"))?;
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = entry
                    .read(&mut buf)
                    .map_err(|e| format!("read zip entry: {e}"))?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n])
                    .map_err(|e| format!("write({dest_path}): {e}"))?;
            }
            Ok(())
        }
        "tar" => {
            let file =
                File::open(&zip_path).map_err(|e| format!("open({zip_path}): {e}"))?;
            extract_one_tar(Box::new(file), &entry_name, &dest_path)
        }
        "tar.gz" => {
            let file =
                File::open(&zip_path).map_err(|e| format!("open({zip_path}): {e}"))?;
            extract_one_tar(
                Box::new(flate2::read::GzDecoder::new(file)),
                &entry_name,
                &dest_path,
            )
        }
        "7z" => {
            // sevenz-rust gives us a callback API. We walk every entry
            // until ours matches, copy bytes to dest, then return false
            // on subsequent entries to short-circuit the rest of the
            // archive walk.
            use std::io::Write;
            let file =
                File::open(&zip_path).map_err(|e| format!("open({zip_path}): {e}"))?;
            let mut found = false;
            let mut io_err: Option<String> = None;
            let dest_clone = dest_path.clone();
            sevenz_rust::decompress_with_extract_fn(
                file,
                "/",
                |entry, reader, _path| {
                    if found {
                        return Ok(false);
                    }
                    if entry.name() != entry_name {
                        return Ok(true);
                    }
                    found = true;
                    let mut out = match File::create(&dest_clone) {
                        Ok(f) => f,
                        Err(e) => {
                            io_err = Some(format!("create({dest_clone}): {e}"));
                            return Ok(false);
                        }
                    };
                    let mut buf = vec![0u8; 64 * 1024];
                    loop {
                        let n = match reader.read(&mut buf) {
                            Ok(n) => n,
                            Err(e) => {
                                io_err = Some(format!("read 7z entry: {e}"));
                                return Ok(false);
                            }
                        };
                        if n == 0 {
                            break;
                        }
                        if let Err(e) = out.write_all(&buf[..n]) {
                            io_err = Some(format!("write({dest_clone}): {e}"));
                            return Ok(false);
                        }
                    }
                    Ok(false)
                },
            )
            .map_err(|e| format!("read 7z({zip_path}): {e}"))?;
            if let Some(e) = io_err {
                return Err(e);
            }
            if !found {
                return Err(format!("entry not found in 7z: {entry_name}"));
            }
            Ok(())
        }
        _ => Err(format!("unsupported archive format: {zip_path}")),
    }
}

/// Walk a tar stream looking for a named entry, copying its contents
/// to `dest_path`. Returns OK once written; errors if the entry isn't
/// found.
fn extract_one_tar(
    reader: Box<dyn std::io::Read>,
    entry_name: &str,
    dest_path: &str,
) -> FsResult<()> {
    use std::fs::File;
    use std::io::Write;
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(|e| format!("read tar: {e}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar entry: {e}"))?;
        let path_bytes = entry.path_bytes();
        let name = String::from_utf8_lossy(&path_bytes);
        if name != entry_name {
            continue;
        }
        let mut out = File::create(dest_path)
            .map_err(|e| format!("create({dest_path}): {e}"))?;
        let mut buf = vec![0u8; 64 * 1024];
        use std::io::Read;
        loop {
            let n = entry
                .read(&mut buf)
                .map_err(|e| format!("read tar entry: {e}"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])
                .map_err(|e| format!("write({dest_path}): {e}"))?;
        }
        return Ok(());
    }
    Err(format!("entry not found in tar: {entry_name}"))
}

/// Bundle one or more local paths into a zip archive at `dest_zip`.
/// Folders are walked recursively. Errors if `dest_zip` already exists
/// (caller should pick a unique destination). Used by the right-click
/// "Compress to zip" action.
#[tauri::command]
pub fn fs_compress_zip(
    paths: Vec<String>,
    dest_zip: String,
) -> FsResult<()> {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::path::Path;
    use walkdir::WalkDir;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    if Path::new(&dest_zip).exists() {
        return Err(format!("destination already exists: {dest_zip}"));
    }
    if paths.is_empty() {
        return Err("no paths to compress".into());
    }
    let file = File::create(&dest_zip)
        .map_err(|e| format!("create({dest_zip}): {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // Common parent: every entry inside the zip is prefixed by the
    // basename of the source path. So `/a/b/foo.txt` becomes
    // `foo.txt` inside the zip; `/a/b/folder/` becomes `folder/...`.
    for src in &paths {
        let src_path = Path::new(src);
        let basename = src_path
            .file_name()
            .ok_or_else(|| format!("no basename: {src}"))?
            .to_string_lossy()
            .to_string();
        let md = std::fs::metadata(src_path)
            .map_err(|e| format!("stat({src}): {e}"))?;
        if md.is_dir() {
            for entry in WalkDir::new(src_path).into_iter().filter_map(|e| e.ok()) {
                let path = entry.path();
                let rel = path
                    .strip_prefix(src_path)
                    .map_err(|e| format!("strip_prefix: {e}"))?;
                let name = if rel.as_os_str().is_empty() {
                    basename.clone()
                } else {
                    format!("{basename}/{}", rel.to_string_lossy())
                };
                if entry.file_type().is_dir() {
                    zip.add_directory(name, opts)
                        .map_err(|e| format!("zip dir: {e}"))?;
                } else if entry.file_type().is_file() {
                    zip.start_file(name, opts)
                        .map_err(|e| format!("zip start_file: {e}"))?;
                    let mut f = File::open(path)
                        .map_err(|e| format!("open({}): {e}", path.display()))?;
                    let mut buf = vec![0u8; 64 * 1024];
                    loop {
                        let n = f
                            .read(&mut buf)
                            .map_err(|e| format!("read({}): {e}", path.display()))?;
                        if n == 0 {
                            break;
                        }
                        zip.write_all(&buf[..n])
                            .map_err(|e| format!("zip write: {e}"))?;
                    }
                }
            }
        } else {
            zip.start_file(&basename, opts)
                .map_err(|e| format!("zip start_file: {e}"))?;
            let mut f = File::open(src_path)
                .map_err(|e| format!("open({src}): {e}"))?;
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = f
                    .read(&mut buf)
                    .map_err(|e| format!("read({src}): {e}"))?;
                if n == 0 {
                    break;
                }
                zip.write_all(&buf[..n])
                    .map_err(|e| format!("zip write: {e}"))?;
            }
        }
    }
    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    Ok(())
}

/// Create an empty file. Errors if the path already exists. Used by
/// the toolbar's "New file" button — same UX as "New folder".
#[tauri::command]
pub fn fs_create_empty_file(path: String) -> FsResult<()> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("already exists: {path}"));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir parent: {e}"))?;
    }
    std::fs::File::create(&p).map_err(|e| format!("create({path}): {e}"))?;
    Ok(())
}

/// Mounted volume entry — populated by `fs_mounts` to drive the
/// Sidebar's Devices section. `removable` lets the UI show external
/// drives differently from the system disk.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountedVolume {
    /// User-visible name (e.g. "Macintosh HD", "USB-NTFS"). Inferred
    /// from the basename of the mount point on macOS / Linux.
    pub name: String,
    /// Absolute path the user clicks to browse this volume.
    pub mount_point: String,
    /// Total bytes on the volume's filesystem. `0` if unavailable.
    pub total: u64,
    /// Bytes the current user can still write. `0` if unavailable.
    pub free: u64,
    /// True for USB / external drives. Drives the icon in the sidebar.
    pub removable: bool,
}

/// Enumerate user-facing mounted volumes. Filters out pseudo-fs
/// (/proc, /sys, /dev, snap loopbacks) and macOS firmlinks (/private/*)
/// so the sidebar only shows mountpoints a user would actually want
/// to navigate.
#[tauri::command]
pub fn fs_mounts() -> FsResult<Vec<MountedVolume>> {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let mut out = Vec::new();
    for d in disks.list() {
        let mount = d.mount_point().to_path_buf();
        let mount_str = mount.to_string_lossy().to_string();

        // Filter pseudo-filesystems + system-internal mounts.
        if cfg!(target_os = "macos") {
            // macOS exposes a lot of system mounts under /System,
            // /private, /dev. Real volumes are at "/" or under
            // "/Volumes/<Name>".
            if mount_str != "/" && !mount_str.starts_with("/Volumes/") {
                continue;
            }
        } else if cfg!(target_os = "linux") {
            if mount_str.starts_with("/proc")
                || mount_str.starts_with("/sys")
                || mount_str.starts_with("/dev")
                || mount_str.starts_with("/run")
                || mount_str.starts_with("/snap")
                || mount_str.starts_with("/var/lib/docker")
            {
                continue;
            }
        }

        let name = if mount_str == "/" {
            "Macintosh HD".to_string()
        } else {
            mount
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| mount_str.clone())
        };

        out.push(MountedVolume {
            name,
            mount_point: mount_str,
            total: d.total_space(),
            free: d.available_space(),
            removable: d.is_removable(),
        });
    }
    // Sort: system disk first ("/"), then alphabetically.
    out.sort_by(|a, b| match (a.mount_point.as_str(), b.mount_point.as_str()) {
        ("/", _) => std::cmp::Ordering::Less,
        (_, "/") => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// SHA-256 hash of a local file. Streams in 64 KB chunks so multi-GB
/// files don't blow up RAM. Returns the hex-encoded digest. Used by
/// the Properties dialog's "Compute SHA-256" button for integrity
/// checks / bug-report metadata.
#[tauri::command]
pub fn fs_hash_sha256(path: String) -> FsResult<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let f = std::fs::File::open(&path).map_err(|e| format!("open({path}): {e}"))?;
    let mut reader = std::io::BufReader::new(f);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read({path}): {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

/// EXIF metadata read off a local image. Optional fields — every key
/// is `null` when the image lacks the corresponding tag (or isn't a
/// JPEG/TIFF where EXIF lives). Used by the PreviewPane to surface
/// "Date taken" / "Camera" alongside the inline image.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageExif {
    pub date_taken: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<String>,
    pub exposure: Option<String>,
    pub aperture: Option<String>,
    pub focal_length: Option<String>,
}

/// Read EXIF from `path`. Returns an empty struct (all `None`) when
/// the file isn't an EXIF-bearing image — callers treat that as "no
/// metadata" rather than as an error so the preview pane stays quiet
/// for PNG / SVG / etc.
#[tauri::command]
pub fn fs_image_exif(path: String) -> FsResult<ImageExif> {
    let file = std::fs::File::open(&path).map_err(|e| format!("open({path}): {e}"))?;
    let mut reader = std::io::BufReader::new(file);
    let exif_reader = exif::Reader::new();
    let exif = match exif_reader.read_from_container(&mut reader) {
        Ok(e) => e,
        Err(_) => return Ok(ImageExif::default()),
    };
    let pick = |tag: exif::Tag| -> Option<String> {
        exif.get_field(tag, exif::In::PRIMARY).map(|f| {
            f.display_value().with_unit(&exif).to_string()
        })
    };
    Ok(ImageExif {
        date_taken: pick(exif::Tag::DateTimeOriginal).or_else(|| pick(exif::Tag::DateTime)),
        camera_make: pick(exif::Tag::Make),
        camera_model: pick(exif::Tag::Model),
        lens: pick(exif::Tag::LensModel),
        iso: pick(exif::Tag::PhotographicSensitivity),
        exposure: pick(exif::Tag::ExposureTime),
        aperture: pick(exif::Tag::FNumber),
        focal_length: pick(exif::Tag::FocalLength),
    })
}

/// Rotate an on-disk image by ±90 / ±180 / ±270 degrees, in place.
///
/// `degrees` is normalized to a {0, 90, 180, 270} bucket (multiples
/// of 90) — anything else is rejected. The image is decoded, rotated
/// in pixel space (lossy round-trip for JPEG; lossless for PNG / GIF
/// / BMP / WebP-lossless), then re-encoded back to its original
/// format. We don't try the EXIF-orientation fast path for JPEG —
/// the gap between "what the user sees in PreviewPane" and "what the
/// file actually contains" is what makes the existing CSS rotation
/// confusing, and an EXIF-only rotate keeps that gap. Going through
/// the pixel buffer is dependable across every image we already
/// preview.
///
/// We write the result atomically via temp + rename so a crash
/// mid-write doesn't leave a half-finished file.
#[tauri::command]
pub fn fs_image_rotate(path: String, degrees: i32) -> FsResult<()> {
    use image::ImageFormat;
    // Normalize to one of {0, 90, 180, 270}. Negative + huge values
    // collapse cleanly via euclidean rem.
    let deg = ((degrees % 360) + 360) % 360;
    if deg % 90 != 0 {
        return Err(format!(
            "fs_image_rotate: degrees must be a multiple of 90 (got {degrees})"
        ));
    }
    if deg == 0 {
        // Nothing to do — caller saved with rotation=0.
        return Ok(());
    }

    let format = ImageFormat::from_path(&path)
        .map_err(|e| format!("fs_image_rotate: unknown format for {path}: {e}"))?;
    // Refuse formats we don't ship encoders for (defense-in-depth —
    // the Cargo.toml feature set already constrains this, but a user
    // could rename a TIFF to .png and we'd surface a confusing decode
    // error otherwise).
    if !matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::Gif | ImageFormat::WebP | ImageFormat::Bmp
    ) {
        return Err(format!(
            "fs_image_rotate: unsupported format ({format:?}) — only JPEG / PNG / GIF / WebP / BMP can be rotated"
        ));
    }

    let img = image::open(&path).map_err(|e| format!("decode({path}): {e}"))?;
    let rotated = match deg {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => unreachable!("checked above"),
    };

    // Atomic write: temp file in same directory, then rename. Same
    // pattern as `settings_save` so a crash mid-encode doesn't
    // truncate the original.
    let path_buf = std::path::PathBuf::from(&path);
    let parent = path_buf
        .parent()
        .ok_or_else(|| format!("fs_image_rotate: no parent dir for {path}"))?;
    let tmp = parent.join(format!(
        ".skiff-rotate-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    rotated
        .save_with_format(&tmp, format)
        .map_err(|e| {
            // Best-effort cleanup of the temp file on encoder error.
            std::fs::remove_file(&tmp).ok();
            format!("encode({}): {e}", tmp.display())
        })?;
    std::fs::rename(&tmp, &path_buf).map_err(|e| {
        std::fs::remove_file(&tmp).ok();
        format!("rename({} → {}): {e}", tmp.display(), path)
    })?;
    Ok(())
}

/// Total + free bytes on the filesystem that hosts `path`. Used by the
/// StatusBar to show "X free of Y" alongside the selection summary.
/// `fs4` reads the per-platform filesystem stats (statvfs / GetDiskFreeSpaceEx)
/// so we don't have to per-OS this ourselves.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    pub total: u64,
    pub free: u64,
}

#[tauri::command]
pub fn fs_disk_space(path: String) -> FsResult<DiskSpace> {
    let p = std::path::Path::new(&path);
    // `available_space` = bytes free for the current user (after quota
    // / reserved). `total_space` = the whole partition's capacity.
    let free = fs4::available_space(p)
        .map_err(|e| format!("available_space({path}): {e}"))?;
    let total = fs4::total_space(p)
        .map_err(|e| format!("total_space({path}): {e}"))?;
    Ok(DiskSpace { total, free })
}

/// Return the OS-specific Trash / Recycle Bin folder path so the
/// Sidebar can offer it as a Favorites entry. macOS: `~/.Trash`,
/// Linux freedesktop: `~/.local/share/Trash/files`. Windows
/// (Recycle Bin) lives behind a shell namespace and isn't a real
/// filesystem path — returns `None` so the frontend can hide the
/// Trash favorite there.
#[tauri::command]
pub fn fs_trash_path() -> FsResult<Option<String>> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Ok(None),
    };
    #[cfg(target_os = "macos")]
    {
        return Ok(Some(home.join(".Trash").to_string_lossy().into_owned()));
    }
    #[cfg(target_os = "linux")]
    {
        return Ok(Some(
            home.join(".local/share/Trash/files")
                .to_string_lossy()
                .into_owned(),
        ));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = home;
        return Ok(None);
    }
    #[allow(unreachable_code)]
    Ok(None)
}

/// Multi-path trash. Cheaper than N round-trips through `invoke` when
/// the user deletes a multi-selection. The crate's `delete_all` is
/// atomic per path: any failures collect, the rest still succeed.
#[tauri::command]
pub fn fs_trash_many(paths: Vec<String>) -> FsResult<()> {
    trash::delete_all(&paths).map_err(|e| format!("trash_many: {e}"))
}

/// Restore the most recently trashed batch matching the given original
/// paths. Cmd/Ctrl+Z in the Browser routes here. Linux + Windows use
/// the `trash::os_limited::restore_all` API. macOS isn't supported by
/// the `trash` crate's restore surface — we surface an actionable
/// error so the frontend can toast "Use Finder's Cmd+Z to undo" and
/// the user knows the limitation isn't a bug.
#[tauri::command]
pub fn fs_trash_restore(_paths: Vec<String>) -> FsResult<u32> {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        use std::collections::HashMap;
        // Index trashed items by their original full path. Multiple
        // versions of the same path may exist (delete-then-restore-
        // then-delete cycles); we keep the most recent (max time_deleted).
        let items = trash::os_limited::list().map_err(|e| format!("trash list: {e}"))?;
        let mut newest: HashMap<String, trash::TrashItem> = HashMap::new();
        for it in items {
            let key = std::path::Path::new(&it.original_parent)
                .join(&it.name)
                .to_string_lossy()
                .into_owned();
            match newest.get(&key) {
                Some(existing) if existing.time_deleted >= it.time_deleted => {}
                _ => {
                    newest.insert(key, it);
                }
            }
        }
        let to_restore: Vec<trash::TrashItem> = _paths
            .iter()
            .filter_map(|p| newest.remove(p))
            .collect();
        let count = to_restore.len() as u32;
        if count == 0 {
            return Err("no matching trash entries found to restore".to_string());
        }
        trash::os_limited::restore_all(to_restore)
            .map_err(|e| format!("restore_all: {e}"))?;
        return Ok(count);
    }
    #[cfg(target_os = "macos")]
    {
        return Err(
            "macOS doesn't support programmatic trash restore. Open Trash and use Finder's Cmd+Z."
                .to_string(),
        );
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        return Err("trash restore not supported on this platform".to_string());
    }
}

// ---------- Settings persistence (Phase 0.1.4) ----------
//
// We keep Settings as opaque JSON on the Rust side — the schema is owned
// by the frontend (see `src/state/settings.tsx`). Storing it as
// `app_data_dir()/settings.json` lets users sync via dotfiles, scrub
// values from a CLI, and survives reinstalls (Tauri's app_data_dir is
// stable across versions).

/// Path the settings JSON lives at. Created on first save.
fn settings_path(app: &tauri::AppHandle) -> FsResult<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir({}): {e}", dir.display()))?;
    Ok(dir.join("settings.json"))
}

/// Load settings JSON. Returns `null` (as a JSON string) if no file
/// exists yet so the frontend can detect first-launch and migrate from
/// localStorage before writing.
#[tauri::command]
pub fn settings_load(app: tauri::AppHandle) -> FsResult<Option<String>> {
    let p = settings_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    let body = std::fs::read_to_string(&p)
        .map_err(|e| format!("read({}): {e}", p.display()))?;
    Ok(Some(body))
}

/// Returns the absolute path of the app data directory. Used by the
/// Settings → Advanced "Reveal app data directory" button so power
/// users can manually inspect settings.json + see whatever else
/// future versions stash there (thumbnail cache, job DB, etc.).
#[tauri::command]
pub fn settings_app_data_dir(app: tauri::AppHandle) -> FsResult<String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    // Make sure it exists — a fresh install with no saved settings
    // yet would otherwise hit "Reveal" against a missing path and
    // confuse the OS file manager.
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir({}): {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Get (or create + cache) a thumbnail for a local image. The
/// returned base64 is a PNG encoding of the source resized so its
/// longest side is `size_px`. Cache key includes (mtime, size,
/// size_px) so an edit invalidates automatically + different
/// thumbnail sizes coexist.
///
/// Errors when the file isn't a decodable image — callers fall back
/// to the kind icon, same as before the cache shipped.
#[tauri::command]
pub fn fs_thumbnail(
    path: String,
    size_px: u32,
    cache: tauri::State<'_, std::sync::Arc<crate::fs::thumbnail::ThumbnailCache>>,
) -> FsResult<String> {
    use base64::Engine as _;
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat({path}): {e}"))?;
    let size_bytes = meta.len() as i64;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    if let Some(cached) = cache.get(&path, mtime_ms, size_bytes, size_px)? {
        return Ok(base64::engine::general_purpose::STANDARD.encode(&cached));
    }
    let png = crate::fs::thumbnail::render_thumbnail(&path, size_px)?;
    cache.put(&path, mtime_ms, size_bytes, size_px, &png)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

/// Cache stats for the Settings → Advanced "Clear thumbnail cache"
/// row. Returns `{ count, bytes }`.
#[tauri::command]
pub fn fs_thumbnail_stats(
    cache: tauri::State<'_, std::sync::Arc<crate::fs::thumbnail::ThumbnailCache>>,
) -> FsResult<crate::fs::thumbnail::CacheStats> {
    cache.stats()
}

/// Wipe every cached thumbnail + VACUUM the database. Returns the
/// number of rows deleted.
#[tauri::command]
pub fn fs_thumbnail_clear(
    cache: tauri::State<'_, std::sync::Arc<crate::fs::thumbnail::ThumbnailCache>>,
) -> FsResult<u64> {
    cache.clear()
}

/// Path to the crash-log directory used by the opt-in panic hook
/// (`crashReportsEnabled` in Settings → Advanced). Returned even
/// when reporting is disabled so the Settings UI can offer
/// "Reveal" without a separate gate. Creates the directory on
/// first call so the OS file manager doesn't choke on a missing
/// path.
#[tauri::command]
pub fn crash_logs_dir(app: tauri::AppHandle) -> FsResult<String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("crashes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir({}): {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Count of `.log` files in the crash-log directory. Used by the
/// Settings → Advanced "Crash logs" badge so users see at a glance
/// whether any reports have been written. Returns 0 if the
/// directory is missing — that's the common case (reporting off).
#[tauri::command]
pub fn crash_logs_count(app: tauri::AppHandle) -> FsResult<u32> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("crashes");
    if !dir.exists() {
        return Ok(0);
    }
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("read_dir({}): {e}", dir.display()))?;
    let mut n: u32 = 0;
    for entry in entries.flatten() {
        if let Some(ext) = entry.path().extension() {
            if ext == "log" {
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Persist the settings blob. We write atomically via a temp file +
/// rename so a partial write doesn't corrupt user state on a crash.
/// After a successful write, broadcasts a `settings:changed` event so
/// other windows in a multi-window session can re-load from disk
/// instead of holding a stale snapshot.
#[tauri::command]
pub fn settings_save(json: String, app: tauri::AppHandle) -> FsResult<()> {
    let final_path = settings_path(&app)?;
    let tmp = final_path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("write({}): {e}", tmp.display()))?;
    std::fs::rename(&tmp, &final_path)
        .map_err(|e| format!("rename({} -> {}): {e}", tmp.display(), final_path.display()))?;
    // Best-effort broadcast — failure here just means siblings won't
    // refresh until they regain focus, which is fine.
    let _ = app.emit("settings:changed", ());
    Ok(())
}

/// Spawn a new top-level window. Used by the Cmd/Ctrl+N keyboard
/// shortcut so the user can have multiple Skiff Files windows open
/// against the same install. Each window gets a unique label so
/// Tauri's window registry doesn't collide.
#[tauri::command]
pub fn window_open_new(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewUrl;
    let label = format!("main-{}", Uuid::new_v4().simple());
    tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Skiff Files")
        .inner_size(1200.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Spawn a new window pre-seeded at `path`. The path is encoded in
/// the URL fragment (`index.html#path=<urlEncoded>`) so the
/// frontend's bootstrap can pick it up before any tab state hydrates
/// from settings. Right-click "Open in new window" routes through
/// this so users can split work across windows without re-typing
/// the path in the new window's path bar.
#[tauri::command]
pub fn window_open_at(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewUrl;
    let label = format!("main-{}", Uuid::new_v4().simple());
    // URL-encode the path so slashes / spaces / Unicode survive the
    // fragment round-trip. The frontend decodeURIComponent's it.
    let encoded = urlencoding::encode(&path).into_owned();
    let url = format!("index.html#path={encoded}");
    tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Skiff Files")
        .inner_size(1200.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Live-reload state for the active tab. The watcher is initialized
/// lazily on first use so apps that never browse the local fs (rare,
/// but possible — e.g. an SFTP-only session) don't pay the cost.
pub type FsWatchState = std::sync::Mutex<Option<crate::fs::watch::WatchHandle>>;

/// Toggle the active window's always-on-top state. Useful for
/// keeping Skiff visible while drag-dropping files OUT of another
/// app — without this, the source app's window would cover Skiff
/// and the user couldn't see where to drop.
#[tauri::command]
pub fn window_set_always_on_top(
    enabled: bool,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("set_always_on_top: {e}"))
}

/// Switch the file watcher to `path`. The frontend calls this on every
/// navigation; the watcher then emits `fs:changed` Tauri events when
/// anything changes in that folder so the Browser can auto-refresh.
/// Skipped for remote paths (sftp://, smb://, …) where local fs
/// notifications don't apply — the frontend filters before calling.
#[tauri::command]
pub fn fs_watch_set(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<FsWatchState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(
            crate::fs::watch::WatchHandle::new(app)
                .map_err(|e| format!("watch init: {e}"))?,
        );
    }
    let handle = guard.as_mut().expect("watch handle just initialized");
    handle
        .set(std::path::Path::new(&path))
        .map_err(|e| format!("watch set({path}): {e}"))
}

/// Stop watching. The Browser calls this when navigating to a remote
/// path so we don't keep a stale local watcher running. Cheap if no
/// watcher was ever initialized.
#[tauri::command]
pub fn fs_watch_clear(
    state: tauri::State<'_, std::sync::Arc<FsWatchState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(h) = guard.as_mut() {
        h.clear();
    }
    Ok(())
}

/// Copy a single file. Returns bytes written.
#[tauri::command]
pub fn fs_copy_file(from: String, to: String) -> FsResult<u64> {
    local::copy_file(Path::new(&from), Path::new(&to))
}

/// Recursively copy a file or folder. Used by the right-click
/// "Duplicate" action — synchronous so the Browser can refresh
/// once the copy is actually on disk (Skiffsync's start_local
/// returns once the job is queued, not done, which makes the
/// post-copy refresh race a stale listing).
#[tauri::command]
pub fn fs_copy_recursive(from: String, to: String) -> FsResult<()> {
    use std::path::Path;
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);
    if to_path.exists() {
        return Err(format!("destination already exists: {to}"));
    }
    let md = std::fs::metadata(from_path)
        .map_err(|e| format!("stat({from}): {e}"))?;
    if md.is_file() {
        std::fs::copy(from_path, to_path)
            .map_err(|e| format!("copy({from} -> {to}): {e}"))?;
        return Ok(());
    }
    if md.is_dir() {
        copy_dir_recursive(from_path, to_path)?;
        return Ok(());
    }
    Err(format!("unsupported source kind for {from}"))
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> FsResult<()> {
    std::fs::create_dir_all(to)
        .map_err(|e| format!("mkdir({}): {e}", to.display()))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("read_dir({}): {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let src = entry.path();
        let dest = to.join(entry.file_name());
        let ft = entry
            .file_type()
            .map_err(|e| format!("file_type({}): {e}", src.display()))?;
        if ft.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else if ft.is_file() {
            std::fs::copy(&src, &dest)
                .map_err(|e| format!("copy({} -> {}): {e}", src.display(), dest.display()))?;
        }
        // Symlinks are skipped — duplicating a symlink as the
        // target's contents is rarely what the user wants on a
        // duplicate.
    }
    Ok(())
}

/// Canonicalize a (possibly relative) path so the path bar can show the
/// real absolute target after a user types `~/foo` or `../bar`. The `~`
/// expansion is not done here — the frontend expands it before invoking.
#[tauri::command]
pub fn fs_canonicalize(path: String) -> FsResult<String> {
    Ok(local::canonicalize(Path::new(&path))?
        .to_string_lossy()
        .into_owned())
}

// ---------- Preview commands (Phase 1.5) ----------

/// Read up to TEXT_PREVIEW_MAX_BYTES of `path` as UTF-8. Used by the right-
/// side preview pane for text/markdown/code files.
#[tauri::command]
pub fn fs_read_text(path: String) -> FsResult<String> {
    local::read_file_text(Path::new(&path), TEXT_PREVIEW_MAX_BYTES)
}

/// Read `path` as base64. The frontend wraps this in a `data:image/...;base64,`
/// URL for inline rendering. We refuse oversized files instead of truncating
/// (a half-image is worse than no preview).
#[tauri::command]
pub fn fs_read_base64(path: String) -> FsResult<String> {
    local::read_file_base64(Path::new(&path), IMAGE_PREVIEW_MAX_BYTES)
}

/// Recursive entries + size for a folder. Capped scan; the response
/// includes `truncated: true` when we hit the cap so the UI can show a
/// "≥" prefix.
#[tauri::command]
pub fn fs_dir_summary(path: String) -> FsResult<DirSummary> {
    local::dir_summary(Path::new(&path), DIR_SCAN_MAX_ENTRIES)
}

/// Hard cap on results returned to the search overlay. Above this the
/// UI gets cluttered and IPC payloads bloat — the user should refine
/// the query instead.
const FIND_MAX_RESULTS: usize = 1_000;

/// Time budget for a single recursive find. Stops the walk early so a
/// user typing `/` doesn't pin the disk for minutes.
const FIND_MAX_SECS: u64 = 10;

/// Recursive substring find. Returns at most FIND_MAX_RESULTS entries;
/// stops walking after FIND_MAX_SECS. Pruned dirs (.git, node_modules,
/// _recycleBin) are skipped — the typical "find under home" use case
/// rarely wants matches there.
#[tauri::command]
pub fn fs_find(
    path: String,
    query: String,
    // Match the query as a JS-flavored regex. Defaults to false so
    // existing callers (pre-0.2.202) keep their substring behavior.
    regex: Option<bool>,
    // Case-sensitive substring / regex match. Defaults to false.
    case_sensitive: Option<bool>,
) -> FsResult<Vec<Entry>> {
    local::find(
        Path::new(&path),
        &query,
        FIND_MAX_RESULTS,
        FIND_MAX_SECS,
        regex.unwrap_or(false),
        case_sensitive.unwrap_or(false),
    )
}

// ---------- Connection commands (Phase 2a) ----------

/// Open a new SFTP connection. Returns the registry id so the frontend
/// can refer to it in subsequent commands. The label shown in the
/// sidebar is `user@host:port`. The known-hosts file lives next to
/// settings.json so TOFU survives reinstalls + can be inspected via
/// "Reveal app data folder".
#[tauri::command]
pub async fn conn_create_sftp(
    config: SftpConfig,
    registry: State<'_, Arc<Registry>>,
    app: tauri::AppHandle,
) -> FsResult<String> {
    if config.password.is_none()
        && config.private_key_path.is_none()
        && !config.use_agent
    {
        return Err("password, privateKeyPath, or useAgent required".into());
    }
    let label = format!("{}@{}:{}", config.user, config.host, config.port);
    let known_hosts_path = known_hosts_path(&app).ok();
    let client = SftpClient::connect(config, known_hosts_path).await?;
    let id = registry.insert(
        ConnectionKind::Sftp,
        label,
        Connection::Sftp(Arc::new(client)),
    );
    Ok(id)
}

/// Open a new plain-FTP connection. Anonymous login (the default
/// user / password values) is the common case for browsing public
/// mirrors; the form on the Connections page exposes user /
/// password fields for authenticated drops. FTPS isn't supported
/// yet (Phase 3b).
#[tauri::command]
pub async fn conn_create_ftp(
    config: FtpConfig,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    let label = if config.user == "anonymous" {
        format!("{}:{}", config.host, config.port)
    } else {
        format!("{}@{}:{}", config.user, config.host, config.port)
    };
    let client = FtpClient::connect(config).await?;
    let id = registry.insert(
        ConnectionKind::Ftp,
        label,
        // FtpClient::connect already wraps in Arc<>, but
        // Connection::Ftp stores its own Arc — unwrap and rewrap.
        Connection::Ftp(client),
    );
    Ok(id)
}

/// Resolve the known-hosts file path under `app_data_dir()`. Mirrors
/// `settings_path` but for SFTP host-key pinning state.
fn known_hosts_path(app: &tauri::AppHandle) -> FsResult<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir({}): {e}", dir.display()))?;
    Ok(dir.join("known_hosts.json"))
}

/// List every `host:port` we have a stored fingerprint for. The
/// frontend uses this to surface a Settings → SSH section so users
/// can audit / forget hosts. Returns an empty list when the file
/// doesn't exist yet.
#[tauri::command]
pub fn conn_known_hosts_list(
    app: tauri::AppHandle,
) -> FsResult<Vec<(String, String)>> {
    let path = known_hosts_path(&app)?;
    let map = crate::fs::known_hosts::load(&path)?;
    Ok(map.into_iter().collect())
}

/// SHA-256 of a file living on a remote SFTP connection. Streams
/// chunked from the russh `File` reader so large media doesn't blow
/// up RAM. Mirrors `fs_hash_sha256` for local paths.
#[tauri::command]
pub async fn conn_hash_sha256(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    let client = registry.get_sftp(&id)?;
    client.hash_sha256(&path).await
}

/// Forget a single `host:port` entry. The next connect to it will
/// re-trust on first use. Idempotent — removing a missing key is
/// not an error.
#[tauri::command]
pub fn conn_known_hosts_remove(
    key_id: String,
    app: tauri::AppHandle,
) -> FsResult<()> {
    let path = known_hosts_path(&app)?;
    let mut map = crate::fs::known_hosts::load(&path).unwrap_or_default();
    if map.remove(&key_id).is_some() {
        crate::fs::known_hosts::save(&path, &map)?;
    }
    Ok(())
}

/// Drop a live connection. Idempotent — disconnecting an already-gone id
/// is not an error since the user just clicked "disconnect" twice.
#[tauri::command]
pub fn conn_disconnect(id: String, registry: State<'_, Arc<Registry>>) -> FsResult<()> {
    registry.remove(&id);
    Ok(())
}

/// List currently-connected hosts for the sidebar / Connections page.
#[tauri::command]
pub fn conn_list(registry: State<'_, Arc<Registry>>) -> FsResult<Vec<ConnectionInfo>> {
    Ok(registry.list())
}

/// Importable hosts pulled from `~/.ssh/config`. The frontend uses
/// these to pre-fill the new-connection form so users don't re-type
/// host / user / port / identity-file paths they've already
/// configured for `ssh`. Missing config file → empty list.
#[tauri::command]
pub fn ssh_config_hosts() -> FsResult<Vec<SshConfigHost>> {
    Ok(load_ssh_config_hosts())
}

/// Remote `list_dir`. Mirrors `fs_list_dir` but routes through the
/// registry-resolved client. We accept the connection id as the first
/// param so the frontend's wrapper signature stays a clean
/// `(id, path, options)`.
#[tauri::command]
pub async fn conn_list_dir(
    id: String,
    path: String,
    options: Option<ListOptions>,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<Vec<Entry>> {
    let opts = options.unwrap_or_default();
    match registry.get(&id).as_deref() {
        Some(Connection::Sftp(client)) => client.list_dir(&path, opts).await,
        Some(Connection::Ftp(client)) => client.list_dir(&path, opts).await,
        None => Err(format!("connection not found: {id}")),
    }
}

#[tauri::command]
pub async fn conn_stat(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<Entry> {
    match registry.get(&id).as_deref() {
        Some(Connection::Sftp(client)) => client.stat(&path).await,
        Some(Connection::Ftp(client)) => client.stat(&path).await,
        None => Err(format!("connection not found: {id}")),
    }
}

#[tauri::command]
pub async fn conn_read_text(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    match registry.get(&id).as_deref() {
        Some(Connection::Sftp(client)) => {
            client.read_text(&path, TEXT_PREVIEW_MAX_BYTES).await
        }
        Some(Connection::Ftp(client)) => {
            client.read_text(&path, TEXT_PREVIEW_MAX_BYTES).await
        }
        None => Err(format!("connection not found: {id}")),
    }
}

#[tauri::command]
pub async fn conn_read_base64(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    match registry.get(&id).as_deref() {
        Some(Connection::Sftp(client)) => {
            client.read_base64(&path, IMAGE_PREVIEW_MAX_BYTES).await
        }
        Some(Connection::Ftp(client)) => {
            client.read_base64(&path, IMAGE_PREVIEW_MAX_BYTES).await
        }
        None => Err(format!("connection not found: {id}")),
    }
}

#[tauri::command]
pub async fn conn_dir_summary(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<DirSummary> {
    let client = registry.get_sftp(&id)?;
    client.dir_summary(&path, DIR_SCAN_MAX_ENTRIES).await
}

/// Remote `mkdir -p`. Idempotent.
#[tauri::command]
pub async fn conn_mkdir(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<()> {
    let client = registry.get_sftp(&id)?;
    client.mkdir(&path).await
}

/// Remote rename / same-FS move.
#[tauri::command]
pub async fn conn_rename(
    id: String,
    from: String,
    to: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<()> {
    let client = registry.get_sftp(&id)?;
    client.rename(&from, &to).await
}

/// Remote remove. Recursive for directories. There's no "send to trash"
/// equivalent on the server side; this is a permanent delete and the
/// frontend should confirm before invoking.
#[tauri::command]
pub async fn conn_remove(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<()> {
    let client = registry.get_sftp(&id)?;
    client.remove(&path).await
}

// ---------- Sync commands (Phase 4a) ----------

/// Run a fully-planned job synchronously. Shared between
/// `sync_start_local` and `sync_start_repo` so the cap check, state
/// transitions, prompt-event wiring, and final summary emit live in
/// one place. Caller is responsible for spawning the worker thread
/// that hosts plan + this run.
fn run_job(
    id: String,
    files: Vec<PlannedFile>,
    total_bytes: u64,
    opts: JobOptions,
    cancel: Arc<CancelToken>,
    jobs: Arc<JobRegistry>,
    hub: Arc<ResolverHub>,
    app: tauri::AppHandle,
) {
    {
        let cap = opts.max_size_gb.saturating_mul(1024 * 1024 * 1024);
        if total_bytes > cap {
            jobs.set_state(&id, JobState::Failed);
            let _ = app.emit(
                "sync:error",
                serde_json::json!({
                    "jobId": id,
                    "error": format!(
                        "total size {} bytes exceeds maxSizeGb={} ({} bytes)",
                        total_bytes, opts.max_size_gb, cap
                    ),
                }),
            );
            return;
        }
        jobs.set_state(&id, JobState::Running);

        let app_progress = app.clone();
        let id_for_progress = id.clone();
        let app_prompt = app.clone();
        let id_for_prompt = id.clone();
        let hub_for_prompt = hub.clone();
        let cancel_for_prompt = cancel.clone();

        // Sticky cache for "Apply to all" decisions. Once the user
        // clicks Overwrite-all / Skip-all / Keep-both-all, the closure
        // returns the per-file equivalent for every subsequent
        // conflict without prompting again. Cleared when the user
        // cancels (irrelevant — job exits) or when the job ends.
        let sticky: std::sync::Arc<std::sync::Mutex<Option<ConflictPromptDecision>>> =
            std::sync::Arc::new(std::sync::Mutex::new(None));
        let summary: Summary = execute_sync(
            &id,
            &files,
            total_bytes,
            &opts,
            cancel,
            move |p| {
                let _ = app_progress.emit("sync:progress", &p);
            },
            // The prompt closure: emit a conflict event with both sides'
            // metadata, then park on the resolver hub. Returns None on
            // cancel — engine treats that as a per-file skip and the
            // outer cancel-check exits the loop next iteration.
            move |file, dest_md| {
                if let Some(d) = *sticky.lock().expect("sticky poisoned") {
                    return Some(d);
                }
                let conflict_id = uuid::Uuid::new_v4().to_string();
                let payload = ConflictPrompt {
                    job_id: id_for_prompt.clone(),
                    conflict_id: conflict_id.clone(),
                    src: file.src.to_string_lossy().into_owned(),
                    dest: file.dest.to_string_lossy().into_owned(),
                    src_size: file.size,
                    dest_size: dest_md.len(),
                    src_mtime: file.mtime,
                    dest_mtime: dest_md
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64),
                };
                let _ = app_prompt.emit("sync:conflict", &payload);
                let answer = hub_for_prompt.wait_for(&conflict_id, &cancel_for_prompt);
                if let Some(a) = answer {
                    if a.is_apply_to_all() {
                        *sticky.lock().expect("sticky poisoned") = Some(a.normalized());
                    }
                }
                answer
            },
        );

        let final_state = if summary.cancelled {
            JobState::Cancelled
        } else {
            JobState::Done
        };
        jobs.set_state(&id_for_progress, final_state);
        let _ = app.emit("sync:done", &summary);
    }
}

/// Start a local-to-local copy job. Cross-protocol jobs land in Phase 4b
/// — for now both `src` and `dest` must be local paths. Returns the new
/// job id; progress streams via the `sync:progress` Tauri event and the
/// final summary via `sync:done`.
#[tauri::command]
pub fn sync_start_local(
    src: String,
    dest: String,
    options: Option<JobOptions>,
    jobs: State<'_, Arc<JobRegistry>>,
    hub: State<'_, Arc<ResolverHub>>,
    app: tauri::AppHandle,
) -> FsResult<String> {
    let opts = options.unwrap_or(JobOptions {
        max_size_gb: 1,
        lookback_days: 7,
        conflict_policy: Default::default(),
        dry_run: false,
        bandwidth_kbps: 0,
        verify_after_copy: false,
    });
    let id = Uuid::new_v4().to_string();
    let info = JobInfo {
        id: id.clone(),
        src: src.clone(),
        dest: dest.clone(),
        state: JobState::Planning,
    };
    let cancel = jobs.insert(info);
    let jobs_arc = (*jobs).clone();
    let hub_arc = (*hub).clone();
    let id_for_plan = id.clone();
    let app_for_plan = app.clone();

    // Run the planner + executor on a blocking thread — std::fs is sync
    // and copying gigabytes shouldn't block the tokio reactor used by
    // the rest of the app (notably russh / SFTP).
    std::thread::spawn(move || {
        let (files, total_bytes) = match plan_sync(Path::new(&src), Path::new(&dest)) {
            Ok(p) => p,
            Err(e) => {
                jobs_arc.set_state(&id_for_plan, JobState::Failed);
                let _ = app_for_plan.emit(
                    "sync:error",
                    serde_json::json!({ "jobId": id_for_plan, "error": e }),
                );
                return;
            }
        };
        run_job(
            id_for_plan,
            files,
            total_bytes,
            opts,
            cancel,
            jobs_arc,
            hub_arc,
            app_for_plan,
        );
    });

    Ok(id)
}

/// Cancel a running job. No-op if unknown — the user might have clicked
/// twice. Always returns Ok.
#[tauri::command]
pub fn sync_cancel(id: String, jobs: State<'_, Arc<JobRegistry>>) -> FsResult<()> {
    jobs.cancel(&id);
    Ok(())
}

/// Pause a running job. The executor blocks between files until
/// `sync_resume` (or `sync_cancel`) flips the flag. Idempotent —
/// pausing an already-paused job is a no-op.
#[tauri::command]
pub fn sync_pause(id: String, jobs: State<'_, Arc<JobRegistry>>) -> FsResult<()> {
    jobs.pause(&id);
    Ok(())
}

/// Resume a paused job. No-op for jobs that aren't currently paused
/// (e.g. running, cancelled, done).
#[tauri::command]
pub fn sync_resume(id: String, jobs: State<'_, Arc<JobRegistry>>) -> FsResult<()> {
    jobs.resume(&id);
    Ok(())
}

/// Frontend → engine reply when the user clicks an action in the
/// TeraCopy-style modal. The `decision` is forwarded to whatever
/// `wait_for(conflict_id)` is currently parked. CancelJob also flips
/// the job's cancel token so the executor exits at the next file.
#[tauri::command]
pub fn sync_resolve_conflict(
    job_id: String,
    conflict_id: String,
    decision: ConflictPromptDecision,
    jobs: State<'_, Arc<JobRegistry>>,
    hub: State<'_, Arc<ResolverHub>>,
) -> FsResult<()> {
    if matches!(decision, ConflictPromptDecision::CancelJob) {
        // Belt-and-suspenders: signal cancel BEFORE depositing the
        // decision so the executor's wakeup sees `is_cancelled = true`
        // and bails for the rest of the queue.
        jobs.cancel(&job_id);
    }
    hub.resolve(conflict_id, decision);
    Ok(())
}

/// List jobs (running, planning, completed, failed). The frontend filters
/// for the queue widget.
#[tauri::command]
pub fn sync_list(jobs: State<'_, Arc<JobRegistry>>) -> FsResult<Vec<JobInfo>> {
    Ok(jobs.list())
}

/// `cpstamp` mode — copy a single file with a `YYYY_MM_DD_HH_MM` suffix
/// into `dest_dir`. Synchronous (the file's small enough we don't need
/// the job lifecycle); returns the path the stamped copy landed at.
#[tauri::command]
pub fn sync_cpstamp(src: String, dest_dir: String) -> FsResult<String> {
    let out = cpstamp(Path::new(&src), Path::new(&dest_dir))?;
    Ok(out.to_string_lossy().into_owned())
}

/// `dedup` mode — recursively scan `path`, find duplicates by md5+size,
/// move extras into `<path>/_recycleBin/<relative-path>`. Returns a
/// summary the UI can show in a toast.
#[tauri::command]
pub fn sync_dedup(path: String) -> FsResult<DedupSummary> {
    run_dedup(Path::new(&path))
}

/// Resolve a frontend path string into a (Backend, remote-path) pair.
/// `sftp://<id>/<path>` routes through the connection registry; any
/// other shape is treated as a local path.
fn resolve_backend(
    path: &str,
    fs_registry: &Registry,
) -> Result<(Backend, String), String> {
    if let Some(rest) = path.strip_prefix("sftp://") {
        let slash = rest.find('/');
        let id = match slash {
            Some(i) => &rest[..i],
            None => rest,
        };
        let remote_path = match slash {
            Some(i) => &rest[i..],
            None => "/",
        };
        let client = fs_registry.get_sftp(id)?;
        Ok((Backend::Sftp(client), remote_path.to_string()))
    } else {
        Ok((Backend::Local, path.to_string()))
    }
}

/// Cross-protocol Skiffsync. Either side may be a local path or
/// `sftp://<connection_id>/<path>`. The frontend's `client.startSync`
/// dispatches here when at least one side is remote; pure local-to-
/// local jobs still go through `sync_start_local` for the kernel-
/// accelerated copy path.
#[tauri::command]
pub fn sync_start_cross(
    src: String,
    dest: String,
    options: Option<JobOptions>,
    jobs: State<'_, Arc<JobRegistry>>,
    fs_registry: State<'_, Arc<Registry>>,
    hub: State<'_, Arc<ResolverHub>>,
    app: tauri::AppHandle,
) -> FsResult<String> {
    let opts = options.unwrap_or(JobOptions {
        max_size_gb: 1,
        lookback_days: 7,
        conflict_policy: Default::default(),
        dry_run: false,
        bandwidth_kbps: 0,
        verify_after_copy: false,
    });
    let id = Uuid::new_v4().to_string();
    let info = JobInfo {
        id: id.clone(),
        src: src.clone(),
        dest: dest.clone(),
        state: JobState::Planning,
    };
    let cancel = jobs.insert(info);

    let jobs_arc = (*jobs).clone();
    let fs_registry_arc = (*fs_registry).clone();
    let hub_arc = (*hub).clone();
    let id_for_plan = id.clone();
    let app_for_plan = app.clone();

    std::thread::spawn(move || {
        // Resolve both sides up front. Errors surface as sync:error so
        // the UI can show the connection-id-not-found / etc. message.
        let (src_backend, src_path) = match resolve_backend(&src, &fs_registry_arc) {
            Ok(p) => p,
            Err(e) => {
                jobs_arc.set_state(&id_for_plan, JobState::Failed);
                let _ = app_for_plan.emit(
                    "sync:error",
                    serde_json::json!({ "jobId": id_for_plan, "error": e }),
                );
                return;
            }
        };
        let (dest_backend, dest_path) = match resolve_backend(&dest, &fs_registry_arc) {
            Ok(p) => p,
            Err(e) => {
                jobs_arc.set_state(&id_for_plan, JobState::Failed);
                let _ = app_for_plan.emit(
                    "sync:error",
                    serde_json::json!({ "jobId": id_for_plan, "error": e }),
                );
                return;
            }
        };

        // Spin a tokio runtime on this worker thread for the async
        // engine. Building one per job is cheap (no thread-pool reuse
        // gain across jobs since each job lives on its own thread).
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                jobs_arc.set_state(&id_for_plan, JobState::Failed);
                let _ = app_for_plan.emit(
                    "sync:error",
                    serde_json::json!({ "jobId": id_for_plan, "error": e.to_string() }),
                );
                return;
            }
        };

        rt.block_on(async {
            let (plan, total_bytes) = match plan_cross(&src_backend, &src_path, &dest_path).await {
                Ok(p) => p,
                Err(e) => {
                    jobs_arc.set_state(&id_for_plan, JobState::Failed);
                    let _ = app_for_plan.emit(
                        "sync:error",
                        serde_json::json!({ "jobId": id_for_plan, "error": e }),
                    );
                    return;
                }
            };
            let cap = opts.max_size_gb.saturating_mul(1024 * 1024 * 1024);
            if total_bytes > cap {
                jobs_arc.set_state(&id_for_plan, JobState::Failed);
                let _ = app_for_plan.emit(
                    "sync:error",
                    serde_json::json!({
                        "jobId": id_for_plan,
                        "error": format!(
                            "total size {} bytes exceeds maxSizeGb={} ({} bytes)",
                            total_bytes, opts.max_size_gb, cap
                        ),
                    }),
                );
                return;
            }
            jobs_arc.set_state(&id_for_plan, JobState::Running);
            let app_progress = app_for_plan.clone();
            // Clone the hub + cancel + app handle once for the prompt
            // closure. The closure body runs once per Prompt-policy
            // conflict; each run gets a fresh conflict_id so multiple
            // parked waits coexist without collision.
            let app_for_prompt = app_for_plan.clone();
            let id_for_prompt = id_for_plan.clone();
            let hub_for_prompt = hub_arc.clone();
            let cancel_for_prompt_outer = cancel.clone();
            // Sticky cache for "Apply to all" decisions, scoped to
            // this job. Same pattern as sync_start_local.
            let sticky_cross: Arc<std::sync::Mutex<Option<ConflictPromptDecision>>> =
                Arc::new(std::sync::Mutex::new(None));
            let summary = execute_cross(
                &id_for_plan,
                plan,
                total_bytes,
                &opts,
                cancel,
                src_backend,
                dest_backend,
                move |p| {
                    let _ = app_progress.emit("sync:progress", &p);
                },
                move |file, dest_meta| {
                    let app = app_for_prompt.clone();
                    let job_id = id_for_prompt.clone();
                    let hub = hub_for_prompt.clone();
                    let cancel = cancel_for_prompt_outer.clone();
                    let sticky = sticky_cross.clone();
                    async move {
                        if let Some(d) = *sticky.lock().expect("sticky poisoned") {
                            return Some(d);
                        }
                        let conflict_id = uuid::Uuid::new_v4().to_string();
                        let payload = ConflictPrompt {
                            job_id,
                            conflict_id: conflict_id.clone(),
                            src: file.src,
                            dest: file.dest,
                            src_size: file.size,
                            dest_size: dest_meta.size,
                            src_mtime: file.mtime,
                            dest_mtime: dest_meta.mtime,
                        };
                        let _ = app.emit("sync:conflict", &payload);
                        let answer = hub.wait_for(&conflict_id, &cancel);
                        if let Some(a) = answer {
                            if a.is_apply_to_all() {
                                *sticky.lock().expect("sticky poisoned") =
                                    Some(a.normalized());
                            }
                        }
                        answer
                    }
                },
            )
            .await;
            let final_state = if summary.cancelled {
                JobState::Cancelled
            } else {
                JobState::Done
            };
            jobs_arc.set_state(&id_for_plan, final_state);
            let _ = app_for_plan.emit("sync:done", &summary);
        });
    });

    Ok(id)
}

/// `cprepo` mode — same shape as `sync_start_local` but the planner
/// only includes files reported by `git ls-files`. Useful for shipping
/// a repo to a backup target without dragging `node_modules/` along.
#[tauri::command]
pub fn sync_start_repo(
    src: String,
    dest: String,
    options: Option<JobOptions>,
    jobs: State<'_, Arc<JobRegistry>>,
    hub: State<'_, Arc<ResolverHub>>,
    app: tauri::AppHandle,
) -> FsResult<String> {
    let opts = options.unwrap_or(JobOptions {
        max_size_gb: 1,
        lookback_days: 7,
        conflict_policy: Default::default(),
        dry_run: false,
        bandwidth_kbps: 0,
        verify_after_copy: false,
    });
    let id = Uuid::new_v4().to_string();
    let info = JobInfo {
        id: id.clone(),
        src: src.clone(),
        dest: dest.clone(),
        state: JobState::Planning,
    };
    let cancel = jobs.insert(info);
    let jobs_arc = (*jobs).clone();
    let hub_arc = (*hub).clone();
    let id_for_plan = id.clone();
    let app_for_plan = app.clone();

    std::thread::spawn(move || {
        let (files, total_bytes) = match plan_repo(Path::new(&src), Path::new(&dest)) {
            Ok(p) => p,
            Err(e) => {
                jobs_arc.set_state(&id_for_plan, JobState::Failed);
                let _ = app_for_plan.emit(
                    "sync:error",
                    serde_json::json!({ "jobId": id_for_plan, "error": e }),
                );
                return;
            }
        };
        run_job(
            id_for_plan,
            files,
            total_bytes,
            opts,
            cancel,
            jobs_arc,
            hub_arc,
            app_for_plan,
        );
    });

    Ok(id)
}


#[cfg(test)]
mod tests {
    use super::*;

    /// Per-test scratch dir under /tmp. Sequence + nanos so parallel
    /// tests don't collide. Same uniq() pattern as the fs/sync tests.
    fn uniq(prefix: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("skiff-{prefix}-{nanos}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Encode a small all-red PNG to disk, rotate 90 degrees, and
    /// verify the resulting file (a) still decodes, (b) has its
    /// width / height swapped, and (c) the corner pixel is still
    /// the same color (rotation is lossless for PNG).
    #[test]
    fn rotates_a_png_lossless_and_swaps_dimensions() {
        let dir = uniq("img-rotate");
        let p = dir.join("red.png");

        // 8x4 red rectangle so the rotation actually changes
        // dimensions (8x4 -> 4x8 after a quarter turn).
        let mut buf = image::RgbImage::new(8, 4);
        for px in buf.pixels_mut() {
            *px = image::Rgb([220, 30, 30]);
        }
        buf.save_with_format(&p, image::ImageFormat::Png).unwrap();

        let path_str = p.to_string_lossy().to_string();
        fs_image_rotate(path_str.clone(), 90).unwrap();

        let after = image::open(&p).unwrap();
        assert_eq!(after.width(), 4, "width should be old height");
        assert_eq!(after.height(), 8, "height should be old width");
        // Color preserved (rotation just permutes pixels).
        let rgb = after.to_rgb8().get_pixel(0, 0).0;
        assert_eq!(rgb, [220, 30, 30]);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 0 / 360 / -720 all collapse to a no-op. Confirms the
    /// modular-arithmetic normalization handles negatives + huge
    /// values without panicking.
    #[test]
    fn zero_or_full_turn_is_noop() {
        let dir = uniq("img-rotate-noop");
        let p = dir.join("a.png");
        let mut buf = image::RgbImage::new(2, 3);
        for px in buf.pixels_mut() {
            *px = image::Rgb([10, 20, 30]);
        }
        buf.save_with_format(&p, image::ImageFormat::Png).unwrap();
        let path_str = p.to_string_lossy().to_string();

        // Original mtime to confirm the no-op path doesn't rewrite.
        let mtime_before = std::fs::metadata(&p).unwrap().modified().unwrap();

        fs_image_rotate(path_str.clone(), 0).unwrap();
        fs_image_rotate(path_str.clone(), 360).unwrap();
        fs_image_rotate(path_str.clone(), -720).unwrap();

        let mtime_after = std::fs::metadata(&p).unwrap().modified().unwrap();
        assert_eq!(
            mtime_before, mtime_after,
            "0 / full-turn should not rewrite the file"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Rejects degree counts that aren't multiples of 90 — we don't
    /// support arbitrary rotation so a 45-degree request must fail
    /// cleanly rather than silently round.
    #[test]
    fn rejects_non_quarter_rotations() {
        let dir = uniq("img-rotate-reject");
        let p = dir.join("a.png");
        image::RgbImage::new(4, 4)
            .save_with_format(&p, image::ImageFormat::Png)
            .unwrap();
        let path_str = p.to_string_lossy().to_string();

        let err = fs_image_rotate(path_str.clone(), 45).unwrap_err();
        assert!(err.contains("multiple of 90"), "got: {err}");
        let err = fs_image_rotate(path_str.clone(), 1).unwrap_err();
        assert!(err.contains("multiple of 90"), "got: {err}");

        std::fs::remove_dir_all(&dir).ok();
    }
}
