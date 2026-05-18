//! Shared types for the sync engine. These cross the Tauri command
//! boundary so all `serde` structs use camelCase for the frontend.

use serde::{Deserialize, Serialize};

/// What to do when the destination already exists. The variants mirror
/// the action set in the TeraCopy "Destination File Already Exists"
/// dialog (see TODO.md → Phase 4) so the future modal can map directly
/// onto these. Three of the names match macOS Finder, the rest match
/// Windows Explorer / TeraCopy power-user vocabulary verbatim — no new
/// terminology invented.
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
    // ----- Smart-batch variants (TeraCopy parity) -----
    /// Overwrite only when the destination's mtime is older than the
    /// source's. Useful for "newer wins" backup semantics.
    OverwriteOlder,
    /// Overwrite only when the destination is smaller than the source.
    /// Used for media re-encodes / partial-download recovery.
    ReplaceSmaller,
    /// Overwrite when sizes differ at all (regardless of which is
    /// larger). Pairs well with the skip-if-same-size heuristic.
    ReplaceIfSizeDifferent,
    /// Move the destination to `name (old).ext` and write the source
    /// under the original name. The user always sees the new copy at
    /// the path they expect; the previous version is preserved.
    RenameTarget,
    /// Like `RenameTarget`, but only when the existing dest is older
    /// than the source. Older targets get aside-renamed; newer targets
    /// stay put (treated as `Skip`).
    RenameOlderTarget,
    /// Block on a user prompt. The engine emits a `sync:conflict`
    /// event, parks on the resolver hub, and applies whatever decision
    /// the frontend dispatches via `sync_resolve_conflict`. Cancelling
    /// the job unblocks the wait and treats it as a cancellation.
    Prompt,
}

/// What the user picks in the TeraCopy-style modal. Maps onto a
/// per-file [`crate::sync::engine::ConflictDecision`] in the engine.
///
/// The `All` variants are the "Apply to all remaining" buttons in the
/// modal — once picked, the engine's closure caches the corresponding
/// non-All decision and never prompts again for this job. The user
/// can still cancel, which unblocks via the cancel token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPromptDecision {
    Overwrite,
    Skip,
    KeepBoth,
    /// Apply Overwrite to this conflict and every subsequent one in
    /// the same job.
    OverwriteAll,
    /// Apply Skip to this conflict and every subsequent one.
    SkipAll,
    /// Apply Keep both to this conflict and every subsequent one.
    KeepBothAll,
    /// Frontend sends this when the user clicks "Cancel" inside the
    /// modal. Engine treats it the same as a `sync_cancel` for the rest
    /// of the job — the wait unblocks, current file is skipped, and
    /// the job exits with `cancelled = true`.
    CancelJob,
}

impl ConflictPromptDecision {
    /// True iff this decision applies to every remaining conflict in
    /// the job. The closures in the command layer cache the non-All
    /// equivalent after seeing one of these.
    pub fn is_apply_to_all(&self) -> bool {
        matches!(
            self,
            ConflictPromptDecision::OverwriteAll
                | ConflictPromptDecision::SkipAll
                | ConflictPromptDecision::KeepBothAll
        )
    }

    /// Convert an "All" variant to its per-file equivalent. No-op for
    /// the non-All variants — they pass through unchanged so callers
    /// can use this as a normalization step.
    pub fn normalized(&self) -> ConflictPromptDecision {
        match self {
            ConflictPromptDecision::OverwriteAll => ConflictPromptDecision::Overwrite,
            ConflictPromptDecision::SkipAll => ConflictPromptDecision::Skip,
            ConflictPromptDecision::KeepBothAll => ConflictPromptDecision::KeepBoth,
            other => *other,
        }
    }
}

/// Frontend-bound payload for `sync:conflict` events. The hub
/// generates a fresh `conflict_id` per pause; the modal echoes it back
/// in `sync_resolve_conflict` so we can match decisions to waiters.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPrompt {
    pub job_id: String,
    pub conflict_id: String,
    pub src: String,
    pub dest: String,
    pub src_size: u64,
    pub dest_size: u64,
    pub src_mtime: Option<i64>,
    pub dest_mtime: Option<i64>,
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
    /// Bandwidth cap in KB/s. `0` (default) = unlimited. When non-zero,
    /// the copy loop pauses between chunks so the running average stays
    /// within the cap. Local-to-local skips the kernel-accelerated path
    /// when this is set; cross-protocol loops chunked anyway.
    #[serde(default)]
    pub bandwidth_kbps: u64,
    /// When true, the engine re-stats the destination after every copy
    /// and confirms its byte count matches the source. Mismatches are
    /// surfaced as per-file errors so the user knows the copy didn't
    /// land cleanly. Optional MD5 verification is a future extension —
    /// size match is enough to catch the common truncation / network-
    /// hiccup failure modes.
    #[serde(default)]
    pub verify_after_copy: bool,
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
    /// User paused — executor is blocked at the next inter-file
    /// checkpoint until `sync_resume` flips the flag (or
    /// `sync_cancel` aborts).
    Paused,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// `is_apply_to_all` is the gate the command layer uses to cache a
    /// non-All version of the decision in `sticky`. Every All-variant
    /// must return true; every per-file variant (including CancelJob)
    /// must return false. If a new variant lands and forgets to wire
    /// itself in, this test fails loudly.
    #[test]
    fn is_apply_to_all_covers_every_variant() {
        use ConflictPromptDecision::*;
        assert!(OverwriteAll.is_apply_to_all());
        assert!(SkipAll.is_apply_to_all());
        assert!(KeepBothAll.is_apply_to_all());
        assert!(!Overwrite.is_apply_to_all());
        assert!(!Skip.is_apply_to_all());
        assert!(!KeepBoth.is_apply_to_all());
        assert!(!CancelJob.is_apply_to_all());
    }

    /// `normalized` is what the sticky cache stores so subsequent
    /// conflicts get a per-file decision back. All-variants map to
    /// their per-file equivalent; everything else passes through.
    #[test]
    fn normalized_maps_all_variants_to_per_file_equivalents() {
        use ConflictPromptDecision::*;
        assert_eq!(OverwriteAll.normalized(), Overwrite);
        assert_eq!(SkipAll.normalized(), Skip);
        assert_eq!(KeepBothAll.normalized(), KeepBoth);
        // Pass-through cases (no-op).
        assert_eq!(Overwrite.normalized(), Overwrite);
        assert_eq!(Skip.normalized(), Skip);
        assert_eq!(KeepBoth.normalized(), KeepBoth);
        assert_eq!(CancelJob.normalized(), CancelJob);
    }

    /// `ConflictPolicy::default()` is the safest choice — leaves the
    /// destination alone. The engine relies on this when no policy is
    /// specified in JobOptions (see `#[serde(default)]` on
    /// `conflict_policy`).
    #[test]
    fn conflict_policy_default_is_skip() {
        assert_eq!(ConflictPolicy::default(), ConflictPolicy::Skip);
    }

    /// JobOptions has serde defaults for every field except none —
    /// passing an empty `{}` should give a fully populated struct
    /// with the documented defaults (1 GB cap, 7-day lookback,
    /// Skip policy, dry-run off, unlimited bandwidth, no verify).
    #[test]
    fn job_options_serde_defaults_match_documented_values() {
        let opts: JobOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(opts.max_size_gb, 1);
        assert_eq!(opts.lookback_days, 7);
        assert_eq!(opts.conflict_policy, ConflictPolicy::Skip);
        assert!(!opts.dry_run);
        assert_eq!(opts.bandwidth_kbps, 0);
        assert!(!opts.verify_after_copy);
    }

    /// Frontend-supplied JobOptions roundtrips when every field is
    /// specified, including the camelCase rename for `maxSizeGb` etc.
    #[test]
    fn job_options_deserializes_full_camelcase_payload() {
        let json = r#"{
            "maxSizeGb": 50,
            "lookbackDays": 30,
            "conflictPolicy": "overwrite",
            "dryRun": true,
            "bandwidthKbps": 1024,
            "verifyAfterCopy": true
        }"#;
        let opts: JobOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.max_size_gb, 50);
        assert_eq!(opts.lookback_days, 30);
        assert_eq!(opts.conflict_policy, ConflictPolicy::Overwrite);
        assert!(opts.dry_run);
        assert_eq!(opts.bandwidth_kbps, 1024);
        assert!(opts.verify_after_copy);
    }

    /// Every ConflictPolicy variant must roundtrip as camelCase JSON.
    /// `replaceIfSizeDifferent` in particular has bitten us before
    /// (renamed in the middle of Phase 4) — pin every variant so
    /// future renames trip CI.
    #[test]
    fn conflict_policy_roundtrips_every_variant() {
        for variant in [
            ConflictPolicy::Skip,
            ConflictPolicy::Overwrite,
            ConflictPolicy::KeepBoth,
            ConflictPolicy::OverwriteOlder,
            ConflictPolicy::ReplaceSmaller,
            ConflictPolicy::ReplaceIfSizeDifferent,
            ConflictPolicy::RenameTarget,
            ConflictPolicy::RenameOlderTarget,
            ConflictPolicy::Prompt,
        ] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: ConflictPolicy = serde_json::from_str(&s).unwrap();
            assert_eq!(variant, back, "roundtrip changed {variant:?} via {s}");
        }
    }

    /// Same pin for ConflictPromptDecision — the All variants are
    /// load-bearing for the sticky-cache logic and a silent rename
    /// would deadlock the conflict loop.
    #[test]
    fn conflict_prompt_decision_roundtrips_every_variant() {
        for variant in [
            ConflictPromptDecision::Overwrite,
            ConflictPromptDecision::Skip,
            ConflictPromptDecision::KeepBoth,
            ConflictPromptDecision::OverwriteAll,
            ConflictPromptDecision::SkipAll,
            ConflictPromptDecision::KeepBothAll,
            ConflictPromptDecision::CancelJob,
        ] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: ConflictPromptDecision = serde_json::from_str(&s).unwrap();
            assert_eq!(variant, back, "roundtrip changed {variant:?} via {s}");
        }
    }

    /// JobState variants are Serialize-only (no Deserialize derive) so
    /// we just check the wire shape. The frontend keys off these
    /// strings to pick the right queue-row icon — renaming any of them
    /// silently is a UI regression we'd never notice from compiler
    /// errors alone.
    #[test]
    fn job_state_serializes_as_documented_camelcase() {
        assert_eq!(serde_json::to_string(&JobState::Planning).unwrap(), "\"planning\"");
        assert_eq!(serde_json::to_string(&JobState::Running).unwrap(), "\"running\"");
        assert_eq!(serde_json::to_string(&JobState::Paused).unwrap(), "\"paused\"");
        assert_eq!(serde_json::to_string(&JobState::Cancelled).unwrap(), "\"cancelled\"");
        assert_eq!(serde_json::to_string(&JobState::Done).unwrap(), "\"done\"");
        assert_eq!(serde_json::to_string(&JobState::Failed).unwrap(), "\"failed\"");
    }

    /// FileOutcome uses `#[serde(tag = "kind")]` for the discriminator.
    /// The frontend's queue widget switches on `kind` so we pin the
    /// four wire-string variants here.
    #[test]
    fn file_outcome_serializes_with_kind_discriminator() {
        let copied = FileOutcome::Copied {
            src: "/a".into(),
            dest: "/b".into(),
            bytes: 42,
        };
        let s = serde_json::to_string(&copied).unwrap();
        assert!(s.contains("\"kind\":\"copied\""), "got: {s}");
        assert!(s.contains("\"bytes\":42"), "got: {s}");

        let skipped = FileOutcome::Skipped {
            src: "/a".into(),
            dest: "/b".into(),
            reason: "same-size".into(),
        };
        let s = serde_json::to_string(&skipped).unwrap();
        assert!(s.contains("\"kind\":\"skipped\""), "got: {s}");

        let conflict = FileOutcome::Conflict {
            src: "/a".into(),
            dest: "/b".into(),
            reason: "policy=skip".into(),
        };
        let s = serde_json::to_string(&conflict).unwrap();
        assert!(s.contains("\"kind\":\"conflict\""), "got: {s}");

        let error = FileOutcome::Error {
            src: "/a".into(),
            dest: "/b".into(),
            error: "boom".into(),
        };
        let s = serde_json::to_string(&error).unwrap();
        assert!(s.contains("\"kind\":\"error\""), "got: {s}");
    }

    /// Progress / Summary / ConflictPrompt / JobInfo are pure data
    /// shapes. We just exercise the camelCase serialization so a
    /// silent field rename trips here before the frontend silently
    /// breaks.
    #[test]
    fn aggregate_payloads_use_camelcase_field_names() {
        let p = Progress {
            job_id: "j".into(),
            files_total: 10,
            files_done: 3,
            bytes_total: 1024,
            bytes_done: 256,
            last: None,
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"jobId\":\"j\""), "got: {s}");
        assert!(s.contains("\"filesTotal\":10"), "got: {s}");
        assert!(s.contains("\"bytesDone\":256"), "got: {s}");

        let sum = Summary {
            job_id: "j".into(),
            copied: 5,
            skipped: 1,
            conflicts: 0,
            errors: 0,
            bytes_copied: 999,
            cancelled: false,
        };
        let s = serde_json::to_string(&sum).unwrap();
        assert!(s.contains("\"bytesCopied\":999"), "got: {s}");
        assert!(s.contains("\"cancelled\":false"), "got: {s}");

        let cp = ConflictPrompt {
            job_id: "j".into(),
            conflict_id: "c".into(),
            src: "/x".into(),
            dest: "/y".into(),
            src_size: 100,
            dest_size: 200,
            src_mtime: Some(1),
            dest_mtime: Some(2),
        };
        let s = serde_json::to_string(&cp).unwrap();
        assert!(s.contains("\"conflictId\":\"c\""), "got: {s}");
        assert!(s.contains("\"srcSize\":100"), "got: {s}");
        assert!(s.contains("\"destMtime\":2"), "got: {s}");

        let info = JobInfo {
            id: "j".into(),
            src: "/x".into(),
            dest: "/y".into(),
            state: JobState::Running,
        };
        let s = serde_json::to_string(&info).unwrap();
        assert!(s.contains("\"state\":\"running\""), "got: {s}");
    }
}
