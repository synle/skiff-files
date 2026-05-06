// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Skiff Files — Tauri v2 backend entry point. The actual fs implementations
//! live in [`fs`]; the Tauri command surface lives in [`commands`]. Keep this
//! file focused on registration so it's easy to see at a glance which commands
//! are exposed.

pub mod commands;
pub mod fs;

use commands::{
    conn_create_sftp, conn_dir_summary, conn_disconnect, conn_list, conn_list_dir,
    conn_read_base64, conn_read_text, conn_stat, fs_canonicalize, fs_copy_file, fs_dir_summary,
    fs_home_dir, fs_list_dir, fs_mkdir, fs_read_base64, fs_read_text, fs_remove, fs_rename,
    fs_stat, get_app_version,
};
use fs::registry::Registry;
use std::sync::Arc;

/// Tauri application entry point. The handler list is the public API of the
/// Rust side — every `invoke()` call from the frontend has to match a name
/// here. The connection registry is `manage`d as Tauri state so async
/// command handlers can reach it via `State<Arc<Registry>>`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(Registry::new()))
        .invoke_handler(tauri::generate_handler![
            // local
            get_app_version,
            fs_home_dir,
            fs_list_dir,
            fs_stat,
            fs_mkdir,
            fs_rename,
            fs_remove,
            fs_copy_file,
            fs_canonicalize,
            fs_read_text,
            fs_read_base64,
            fs_dir_summary,
            // connections
            conn_create_sftp,
            conn_disconnect,
            conn_list,
            conn_list_dir,
            conn_stat,
            conn_read_text,
            conn_read_base64,
            conn_dir_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_is_non_empty() {
        assert!(!get_app_version().is_empty());
    }

    #[test]
    fn home_dir_resolves() {
        // Should always succeed in CI runners (which have $HOME / %USERPROFILE%).
        let home = fs_home_dir().expect("home dir");
        assert!(!home.is_empty());
    }
}
