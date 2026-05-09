//! Filesystem watcher backing the auto-refresh affordance. We hold a single
//! global `RecommendedWatcher` (kqueue / inotify / ReadDirectoryChangesW
//! depending on the OS) and re-target it whenever the foreground tab
//! navigates. The watcher emits a debounced `fs:changed` Tauri event with
//! the path that triggered, so the Browser can decide whether to refresh.
//!
//! Why a single watcher (not one per tab): re-watching is cheap on every
//! supported OS and we don't want N file descriptors / kernel queues open
//! when the user has 20 tabs. The frontend always tells us which path it
//! cares about; we swap the watch target whenever the active tab changes.
//!
//! The debounce is deliberate: the OS fires many events for a single
//! user-visible operation (a file save can produce write + close + rename
//! events). We collapse anything within `DEBOUNCE_MS` into one Tauri emit.

use notify::{
    event::{EventKind, ModifyKind},
    Event, RecommendedWatcher, RecursiveMode, Watcher,
};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Coalesce events fired within this window into a single Tauri emit.
/// Empirically 150 ms is enough to swallow the "modify + close" sequence
/// macOS produces on a save while still feeling instant in the UI.
const DEBOUNCE_MS: u64 = 150;

/// Holds the watcher + the last path we asked it to observe. Swapping
/// targets unwatches the previous path before subscribing to the new one
/// so we don't accumulate kernel resources.
pub struct WatchHandle {
    watcher: RecommendedWatcher,
    current: Option<PathBuf>,
    /// Tracks the most recent emit time per path so the debouncer knows
    /// when to throttle vs. fire fresh.
    last_emit: Arc<Mutex<Option<Instant>>>,
}

impl WatchHandle {
    /// Build a watcher whose callback emits a debounced `fs:changed`
    /// Tauri event with the watched path. Errors during creation
    /// (notify on a sandboxed runner that lacks fs APIs, e.g.) bubble up
    /// so the caller can log + fall back to manual refresh.
    pub fn new(app: AppHandle) -> notify::Result<Self> {
        let last_emit: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let last_emit_cb = Arc::clone(&last_emit);
        let app_cb = app.clone();
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let event = match res {
                Ok(e) => e,
                Err(_) => return,
            };
            // Skip access events — they fire on every read on macOS and
            // would spam the frontend with refreshes the user doesn't
            // care about. We only refresh on create / remove / modify
            // / rename, which is what the user expects "directory
            // changed" to mean.
            if !matches!(
                event.kind,
                EventKind::Create(_)
                    | EventKind::Remove(_)
                    | EventKind::Modify(ModifyKind::Name(_))
                    | EventKind::Modify(ModifyKind::Data(_))
                    | EventKind::Modify(ModifyKind::Any)
            ) {
                return;
            }
            // Debounce: drop emits within DEBOUNCE_MS of the last one.
            let now = Instant::now();
            {
                let mut guard = last_emit_cb.lock().expect("watcher lock");
                if let Some(prev) = *guard {
                    if now.duration_since(prev) < Duration::from_millis(DEBOUNCE_MS) {
                        return;
                    }
                }
                *guard = Some(now);
            }
            // Emit the path that changed (first path in the event; some
            // backends report multiple). Frontend filters by its current
            // working directory.
            let path = event
                .paths
                .first()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let _ = app_cb.emit("fs:changed", path);
        })?;
        Ok(Self {
            watcher,
            current: None,
            last_emit,
        })
    }

    /// Switch the watcher to a new path. No-op when the target hasn't
    /// changed (avoids the unwatch + re-watch syscall churn on path-bar
    /// re-paints that re-fire `fs_watch_set`).
    pub fn set(&mut self, path: &Path) -> notify::Result<()> {
        if self.current.as_deref() == Some(path) {
            return Ok(());
        }
        if let Some(prev) = self.current.take() {
            // Best-effort unwatch — failure here just means the old
            // path is gone, which the new watch_recursive call would
            // hit too. Don't bubble.
            let _ = self.watcher.unwatch(&prev);
        }
        // Non-recursive: we only care about events in the visible
        // folder. Recursive would also fire on subfolder changes the
        // user can't see, which is wasted work.
        self.watcher.watch(path, RecursiveMode::NonRecursive)?;
        self.current = Some(path.to_path_buf());
        // Reset debounce tracker so the first event after a re-target
        // fires immediately rather than getting eaten by a stale Instant.
        if let Ok(mut guard) = self.last_emit.lock() {
            *guard = None;
        }
        Ok(())
    }

    /// Stop watching. Useful when the user navigates to a remote
    /// (`sftp://...`) path where local fs notifications don't apply.
    pub fn clear(&mut self) {
        if let Some(prev) = self.current.take() {
            let _ = self.watcher.unwatch(&prev);
        }
    }
}
