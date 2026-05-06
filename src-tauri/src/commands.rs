//! Tauri command surface. Each function here is a thin adapter: it accepts
//! string paths from the frontend, hands them to the [`crate::fs`] module, and
//! returns either a serializable struct or a string error message.
//!
//! Commands live here (rather than `lib.rs`) so the registration list in
//! `lib.rs` stays a one-liner per command — easier to scan and reorder.

use crate::fs::local::{self, DirSummary};
use crate::fs::registry::{Connection, ConnectionInfo, ConnectionKind, Registry};
use crate::fs::sftp::{SftpClient, SftpConfig};
use crate::fs::types::{Entry, FsResult, ListOptions};
use std::path::Path;
use std::sync::Arc;
use tauri::State;

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

/// Delete a file or directory (recursive for dirs). The Phase 6 polish step
/// will replace this with a "send to OS trash" path via the `trash` crate;
/// this command will then become the "permanent delete" path behind a
/// confirmation dialog.
#[tauri::command]
pub fn fs_remove(path: String) -> FsResult<()> {
    local::remove(Path::new(&path))
}

/// Copy a single file. Returns bytes written.
#[tauri::command]
pub fn fs_copy_file(from: String, to: String) -> FsResult<u64> {
    local::copy_file(Path::new(&from), Path::new(&to))
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

// ---------- Connection commands (Phase 2a) ----------

/// Open a new SFTP connection. Returns the registry id so the frontend
/// can refer to it in subsequent commands. The label shown in the
/// sidebar is `user@host:port`.
#[tauri::command]
pub async fn conn_create_sftp(
    config: SftpConfig,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    if config.password.is_none() && config.private_key_path.is_none() {
        return Err("password or privateKeyPath required".into());
    }
    let label = format!("{}@{}:{}", config.user, config.host, config.port);
    let client = SftpClient::connect(config).await?;
    let id = registry.insert(
        ConnectionKind::Sftp,
        label,
        Connection::Sftp(Arc::new(client)),
    );
    Ok(id)
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
    let client = registry.get_sftp(&id)?;
    client
        .list_dir(&path, options.unwrap_or_default())
        .await
}

#[tauri::command]
pub async fn conn_stat(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<Entry> {
    let client = registry.get_sftp(&id)?;
    client.stat(&path).await
}

#[tauri::command]
pub async fn conn_read_text(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    let client = registry.get_sftp(&id)?;
    client.read_text(&path, TEXT_PREVIEW_MAX_BYTES).await
}

#[tauri::command]
pub async fn conn_read_base64(
    id: String,
    path: String,
    registry: State<'_, Arc<Registry>>,
) -> FsResult<String> {
    let client = registry.get_sftp(&id)?;
    client.read_base64(&path, IMAGE_PREVIEW_MAX_BYTES).await
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
