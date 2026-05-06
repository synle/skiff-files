//! Shared types for the sync engine. These cross the Tauri command
//! boundary so all `serde` structs use camelCase for the frontend.

use serde::{Deserialize, Serialize};

/// What to do when the destination already exists. The TeraCopy-style
/// smart-batch options ("overwrite all older", "replace if different
/// size") will surface as additional variants in Phase 4b once the UI
/// has the modal to pick them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Leave the destination alone. Default — safest.
    Skip,
    /// Overwrite the destination unconditionally.
    Overwrite,
    /// Write a sibling: `name (2).ext`, `name (3).ext`, ... so neither
    /// file is lost. Mirrors macOS Finder's "Keep both" affordance.
    KeepBoth,
}

impl Default for ConflictPolicy {
    fn default() -> Self {
        Self::Skip
    }
}

/// User-supplied job parameters. The fields mirror `cpsync`'s knobs
/// where they overlap (`max_size_gb`, `lookback_days`); newer flags are
/// Skiff-specific.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobOptions {
    /// Hard cap on total bytes. The engine pre-scans before copying any
    /// data and aborts if the source exceeds this; matches `cpsync`'s
    /// safety net so a stray click on `~` doesn't paginate the whole
    /// disk.
    #[serde(default = "default_max_gb")]
    pub max_size_gb: u64,
    /// Skip-if-unchanged: same-size files are considered equal up to
    /// `lookback_days`. Files older than that are still skipped if size
    /// matches. Setting this to `0` disables the heuristic.
    #[serde(default = "default_lookback_days")]
    pub lookback_days: u64,
    /// Conflict policy for files that exist on dest. Folders are
    /// always merged.
    #[serde(default)]
    pub conflict_policy: ConflictPolicy,
    /// If `true`, walks the tree and reports the plan but copies nothing.
    /// Used by the dry-run preview.
    #[serde(default)]
    pub dry_run: bool,
}

fn default_max_gb() -> u64 {
    1
}
fn default_lookback_days() -> u64 {
    7
}

/// Per-file outcome we emit on every step. `None` for `error` means the
/// file was processed successfully.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FileOutcome {
    /// File copied (or would-have-been-copied in dry-run).
    Copied { src: String, dest: String, bytes: u64 },
    /// Skipped because src and dest match the skip-if-unchanged heuristic.
    Skipped { src: String, dest: String, reason: String },
    /// Skipped because of the conflict policy.
    Conflict { src: String, dest: String, reason: String },
    /// Failure — typically per-file so the rest of the job continues.
    Error { src: String, dest: String, error: String },
}

/// Aggregate progress payload, emitted after each file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub job_id: String,
    pub files_total: u64,
    pub files_done: u64,
    pub bytes_total: u64,
    pub bytes_done: u64,
    /// Most recent per-file outcome. `None` if the engine is still
    /// pre-scanning.
    pub last: Option<FileOutcome>,
}

/// Final summary, emitted once on `sync:done`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub job_id: String,
    pub copied: u64,
    pub skipped: u64,
    pub conflicts: u64,
    pub errors: u64,
    pub bytes_copied: u64,
    pub cancelled: bool,
}

/// Lifecycle states a job moves through. The frontend uses this to
/// pick the right icon / progress widget per row in the queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    /// Pre-scan in progress.
    Planning,
    /// Active copy in flight.
    Running,
    /// User cancelled (between files).
    Cancelled,
    /// Completed without cancellation.
    Done,
    /// Pre-scan or job-level fatal error (NOT per-file errors, which are
    /// rolled into `Summary.errors`).
    Failed,
}

/// What a `sync_list` call returns. Only includes the bookkeeping fields
/// — progress is delivered via events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    pub src: String,
    pub dest: String,
    pub state: JobState,
}
