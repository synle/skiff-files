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

/// Multi-path trash. Cheaper than N round-trips through `invoke` when
/// the user deletes a multi-selection. The crate's `delete_all` is
/// atomic per path: any failures collect, the rest still succeed.
#[tauri::command]
pub fn fs_trash_many(paths: Vec<String>) -> FsResult<()> {
    trash::delete_all(&paths).map_err(|e| format!("trash_many: {e}"))
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

/// Persist the settings blob. We write atomically via a temp file +
/// rename so a partial write doesn't corrupt user state on a crash.
#[tauri::command]
pub fn settings_save(json: String, app: tauri::AppHandle) -> FsResult<()> {
    let final_path = settings_path(&app)?;
    let tmp = final_path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("write({}): {e}", tmp.display()))?;
    std::fs::rename(&tmp, &final_path)
        .map_err(|e| format!("rename({} -> {}): {e}", tmp.display(), final_path.display()))?;
    Ok(())
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
pub fn fs_find(path: String, query: String) -> FsResult<Vec<Entry>> {
    local::find(
        Path::new(&path),
        &query,
        FIND_MAX_RESULTS,
        FIND_MAX_SECS,
    )
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
                hub_for_prompt.wait_for(&conflict_id, &cancel_for_prompt)
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
