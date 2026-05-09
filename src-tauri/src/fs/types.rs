//! Shared types crossing the Tauri command boundary.
//!
//! All `serde` structs use `rename_all = "camelCase"` so the React frontend can
//! consume them with idiomatic JS field names without a translation layer.

use serde::{Deserialize, Serialize};

/// Coarse file kind for icon + sort grouping in the UI. Derived from the file
/// extension (see [`crate::fs::icons::kind_for_path`]); never trusted for
/// security decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Folder,
    Symlink,
    Text,
    Code,
    Markdown,
    Image,
    Audio,
    Video,
    Archive,
    Pdf,
    Spreadsheet,
    Document,
    Binary,
    Unknown,
}

/// One row in the file list. `mtime` is unix seconds (UTC). `size` is `0` for
/// directories — UIs that want a recursive total compute it on demand.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    /// Unix seconds. `None` if the platform / FS can't provide it.
    pub mtime: Option<i64>,
    /// Unix seconds for file creation time (birth time on macOS / FAT,
    /// ctime fallback on Linux ext4 where birth isn't always available).
    /// `None` when the platform / filesystem doesn't expose it.
    pub ctime: Option<i64>,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    /// Permission bits. `None` on Windows where the concept doesn't map cleanly.
    pub mode: Option<u32>,
}

/// What a list_dir caller wants. Toggled from the Settings page.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    /// Include dotfiles / system-hidden files. Defaults to `false`.
    #[serde(default)]
    pub show_hidden: bool,
}

/// Errors from the fs layer flow to the frontend as strings — Tauri serializes
/// the `Display` of the error. Using a typed enum on the frontend would buy us
/// little here since most failures are platform / IO specific.
pub type FsResult<T> = Result<T, String>;
