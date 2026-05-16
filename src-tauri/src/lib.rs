// NOTE: the `windows_subsystem = "windows"` attribute that prevents a
// console window on Windows release builds lives on the binary root
// (`main.rs`), not here. An inner attribute on `lib.rs` is silently
// ignored by Rust — see the regression test
// `windows_subsystem_attribute_lives_on_binary_root` below.

//! Skiff Files — Tauri v2 backend entry point. The actual fs implementations
//! live in [`fs`]; the Tauri command surface lives in [`commands`]. Keep this
//! file focused on registration so it's easy to see at a glance which commands
//! are exposed.

pub mod commands;
pub mod crash;
pub mod creds;
pub mod fs;
pub mod sync;
pub mod win_cmd;

use commands::{
    conn_create_ftp, conn_create_sftp, conn_create_smb, conn_dir_summary, conn_disconnect, conn_hash_sha256,
    conn_known_hosts_list, conn_known_hosts_remove, conn_list, conn_list_dir, conn_mkdir,
    conn_create_empty_file,
    conn_read_base64, conn_read_text, conn_remove, conn_rename, conn_stat, crash_logs_count,
    crash_logs_dir, fs_archive_extract_one,
    fs_archive_list, fs_canonicalize,
    fs_copy_file, fs_dir_summary, fs_find, fs_home_dir, fs_list_dir, fs_mkdir, fs_read_base64,
    fs_compress_zip, fs_copy_recursive, fs_create_empty_file, fs_disk_space,
    fs_extract_zip, fs_hash_sha256, fs_image_exif, fs_image_rotate, fs_mounts, fs_open_in_terminal,
    fs_thumbnail, fs_thumbnail_clear, fs_thumbnail_stats,
    fs_open_with_default, fs_read_text, fs_remove, fs_rename, fs_reveal_in_os,
    fs_trash_path,
    creds_capable, creds_delete, creds_load, creds_store,
    fs_stat, fs_trash, fs_trash_many, fs_trash_restore, get_app_version, settings_app_data_dir, settings_load,
    settings_save, window_open_at, window_open_new, window_set_always_on_top,
    fs_watch_clear, fs_watch_set, FsWatchState,
    smb_list_shares, ssh_config_hosts, sync_cancel, sync_cpstamp, sync_dedup,
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
        .plugin(tauri_plugin_dialog::init())
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
            creds_store,
            creds_load,
            creds_delete,
            creds_capable,
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
            smb_list_shares,
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
            conn_create_empty_file,
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

    /// Regression test for the Windows console-flash class of bug.
    ///
    /// The `windows_subsystem = "windows"` attribute only takes effect on the
    /// binary's root source file (`main.rs`). Rust silently accepts the inner
    /// attribute on `lib.rs` but the binary's PE subsystem header is unchanged,
    /// which causes the release `.exe` to ship as a console-subsystem app and
    /// pop a console window on launch (Windows allocates one for every
    /// console-subsystem program).
    ///
    /// This trap bit `sqlui-native` at v3.1.9 — same project, same fix. This
    /// test fails the build if the attribute drifts onto `lib.rs` as a live
    /// inner attribute, or disappears from `main.rs`.
    #[test]
    fn windows_subsystem_attribute_lives_on_binary_root() {
        let main_rs = include_str!("main.rs");
        let lib_rs = include_str!("lib.rs");

        let needle = "#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]";
        assert!(
            main_rs.contains(needle),
            "src-tauri/src/main.rs MUST contain `{}` — without it the Windows \
             release binary builds as a console-subsystem app and pops a console \
             window. See the sqlui-native v3.1.9 fix for the same trap.",
            needle
        );

        // The attribute is silently ignored on `lib.rs`. Allow the literal
        // substring to appear only inside a comment (the breadcrumb we leave
        // behind), never as an active inner attribute.
        let mut on_live_line = false;
        for line in lib_rs.lines() {
            let trimmed = line.trim_start();
            if trimmed.contains(needle) && !trimmed.starts_with("//") {
                on_live_line = true;
                break;
            }
        }
        assert!(
            !on_live_line,
            "src-tauri/src/lib.rs MUST NOT carry the `windows_subsystem` inner \
             attribute as live code — it is silently ignored there. Keep the \
             canonical declaration in `main.rs`."
        );
    }

    /// Regression test for the Windows console-flash bug on child spawns.
    ///
    /// The GUI parent has no console (`windows_subsystem = "windows"`). A bare
    /// `Command::new("git" | "powershell" | "reg")` from a Windows code path
    /// allocates and tears down its own console window, visible as a flash on
    /// every short-lived spawn (Skiffsync `cprepo` shelling out to
    /// `git ls-files` is the recurring offender). Route the spawn through
    /// `win_cmd::hidden_command(...)` instead — it pre-applies the
    /// `CREATE_NO_WINDOW` (`0x08000000`) creation flag on Windows and is a
    /// no-op everywhere else.
    ///
    /// This test fails the build if a bare `Command::new("git" | "powershell"
    /// | "reg")` appears in production code (the helper itself, the
    /// intentional "Open Terminal" `cmd /K` spawn in `commands.rs`, and
    /// `#[cfg(test)]` blocks are all excluded from the scan).
    #[test]
    fn no_bare_console_spawns_in_production_code() {
        let files: &[(&str, &str)] = &[
            ("sync/repo.rs", include_str!("sync/repo.rs")),
            // Extend this list as new production-side `Command::new(...)`
            // sites land. Skip files whose only spawn is intentionally
            // user-visible (e.g. `commands.rs::fs_open_in_terminal` runs
            // `cmd /K` because the user *asked* for a terminal).
        ];
        let banned = [
            r#"Command::new("git")"#,
            r#"Command::new("powershell")"#,
            r#"Command::new("reg")"#,
        ];
        for (path, src) in files {
            // Drop the `#[cfg(test)] mod tests { ... }` block — those spawns
            // run under `cargo test`, which already has a terminal.
            let prod = match src.find("#[cfg(test)]") {
                Some(i) => &src[..i],
                None => src,
            };
            for pattern in &banned {
                assert!(
                    !prod.contains(pattern),
                    "{}: found bare `{}` in production code — route it through \
                     `crate::win_cmd::hidden_command(...)` to avoid the Windows \
                     console flash.",
                    path,
                    pattern
                );
            }
        }
    }
}
