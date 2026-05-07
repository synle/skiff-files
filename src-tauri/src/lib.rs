// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Skiff Files — Tauri v2 backend entry point. The actual fs implementations
//! live in [`fs`]; the Tauri command surface lives in [`commands`]. Keep this
//! file focused on registration so it's easy to see at a glance which commands
//! are exposed.

pub mod commands;
pub mod fs;
pub mod sync;

use commands::{
    conn_create_sftp, conn_dir_summary, conn_disconnect, conn_list, conn_list_dir, conn_mkdir,
    conn_read_base64, conn_read_text, conn_remove, conn_rename, conn_stat, fs_canonicalize,
    fs_copy_file, fs_dir_summary, fs_find, fs_home_dir, fs_list_dir, fs_mkdir, fs_read_base64,
    fs_disk_space, fs_open_with_default, fs_read_text, fs_remove, fs_rename, fs_reveal_in_os,
    fs_stat, fs_trash, fs_trash_many, get_app_version, settings_load, settings_save,
    ssh_config_hosts, sync_cancel, sync_cpstamp, sync_dedup,
    sync_list, sync_pause, sync_resolve_conflict, sync_resume, sync_start_cross, sync_start_local,
    sync_start_repo,
};
use fs::registry::Registry;
use std::sync::Arc;
use sync::registry::JobRegistry;
use sync::resolver::ResolverHub;

/// Tauri application entry point. The handler list is the public API of the
/// Rust side — every `invoke()` call from the frontend has to match a name
/// here. The connection registry is `manage`d as Tauri state so async
/// command handlers can reach it via `State<Arc<Registry>>`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(Registry::new()))
        .manage(Arc::new(JobRegistry::new()))
        .manage(Arc::new(ResolverHub::new()))
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
            fs_find,
            fs_trash,
            fs_trash_many,
            fs_reveal_in_os,
            fs_open_with_default,
            fs_disk_space,
            settings_load,
            settings_save,
            ssh_config_hosts,
            // connections
            conn_create_sftp,
            conn_disconnect,
            conn_list,
            conn_list_dir,
            conn_stat,
            conn_read_text,
            conn_read_base64,
            conn_dir_summary,
            conn_mkdir,
            conn_rename,
            conn_remove,
            // sync
            sync_start_local,
            sync_start_repo,
            sync_start_cross,
            sync_cpstamp,
            sync_dedup,
            sync_cancel,
            sync_pause,
            sync_resume,
            sync_resolve_conflict,
            sync_list,
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
