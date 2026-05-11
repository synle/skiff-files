// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Skiff Files — Tauri v2 backend entry point. The actual fs implementations
//! live in [`fs`]; the Tauri command surface lives in [`commands`]. Keep this
//! file focused on registration so it's easy to see at a glance which commands
//! are exposed.

pub mod commands;
pub mod crash;
pub mod fs;
pub mod sync;

use commands::{
    conn_create_ftp, conn_create_sftp, conn_create_smb, conn_dir_summary, conn_disconnect, conn_hash_sha256,
    conn_known_hosts_list, conn_known_hosts_remove, conn_list, conn_list_dir, conn_mkdir,
    conn_read_base64, conn_read_text, conn_remove, conn_rename, conn_stat, crash_logs_count,
    crash_logs_dir, fs_archive_extract_one,
    fs_archive_list, fs_canonicalize,
    fs_copy_file, fs_dir_summary, fs_find, fs_home_dir, fs_list_dir, fs_mkdir, fs_read_base64,
    fs_compress_zip, fs_copy_recursive, fs_create_empty_file, fs_disk_space,
    fs_extract_zip, fs_hash_sha256, fs_image_exif, fs_image_rotate, fs_mounts, fs_open_in_terminal,
    fs_thumbnail, fs_thumbnail_clear, fs_thumbnail_stats,
    fs_open_with_default, fs_read_text, fs_remove, fs_rename, fs_reveal_in_os,
    fs_trash_path,
    fs_stat, fs_trash, fs_trash_many, fs_trash_restore, get_app_version, settings_app_data_dir, settings_load,
    settings_save, window_open_at, window_open_new, window_set_always_on_top,
    fs_watch_clear, fs_watch_set, FsWatchState,
    ssh_config_hosts, sync_cancel, sync_cpstamp, sync_dedup,
    sync_list, sync_pause, sync_resolve_conflict, sync_resume, sync_start_cross, sync_start_local,
    sync_start_repo,
};
use fs::registry::Registry;
use fs::thumbnail::ThumbnailCache;
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
        .plugin(tauri_plugin_drag::init())
        .manage(Arc::new(Registry::new()))
        .manage(Arc::new(JobRegistry::new()))
        .manage(Arc::new(ResolverHub::new()))
        .manage(Arc::new(FsWatchState::new(None)))
        .setup(|app| {
            // Opt-in panic-hook installation. We read the user's
            // `crashReportsEnabled` flag straight out of the
            // settings.json on disk because it has to be decided
            // before any Rust code can panic — long before the
            // frontend mounts and pushes settings via IPC. Default
            // false means most users never see this code path.
            use tauri::Manager;
            if let Ok(dir) = app.path().app_data_dir() {
                if crash::crash_reports_enabled(&dir) {
                    crash::install_panic_hook(dir.join("crashes"));
                }
                // Open the thumbnail cache against the same data
                // dir. We `manage` it as Tauri State so the
                // fs_thumbnail* commands can borrow it on every
                // call. Failure here is non-fatal — the worst case
                // is thumbnail commands erroring out + GalleryThumb
                // falling back to the kind icon (its existing
                // failure mode), so we log + continue rather than
                // refusing to launch the app.
                match ThumbnailCache::open(&dir.join("thumbnails.db")) {
                    Ok(cache) => {
                        app.manage(Arc::new(cache));
                    }
                    Err(e) => {
                        eprintln!("thumbnail cache init: {e}");
                    }
                }
            }
            Ok(())
        })
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
            fs_trash_path,
            fs_trash_restore,
            fs_reveal_in_os,
            fs_open_with_default,
            fs_open_in_terminal,
            fs_image_exif,
            fs_image_rotate,
            fs_thumbnail,
            fs_thumbnail_stats,
            fs_thumbnail_clear,
            fs_hash_sha256,
            fs_mounts,
            fs_create_empty_file,
            fs_compress_zip,
            fs_extract_zip,
            fs_archive_list,
            fs_archive_extract_one,
            fs_copy_recursive,
            fs_disk_space,
            settings_load,
            settings_save,
            settings_app_data_dir,
            crash_logs_dir,
            crash_logs_count,
            window_open_new,
            window_open_at,
            window_set_always_on_top,
            fs_watch_set,
            fs_watch_clear,
            ssh_config_hosts,
            // connections
            conn_create_sftp,
            conn_create_ftp,
            conn_create_smb,
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
            conn_known_hosts_list,
            conn_known_hosts_remove,
            conn_hash_sha256,
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
