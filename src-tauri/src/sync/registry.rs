//! Sync-job registry. Tracks running + completed jobs so the frontend
//! can list them and cancel the right one. Holds the `CancelToken` per
//! job; the executor itself runs on a tokio task spawned by the command
//! layer.

use super::engine::CancelToken;
use super::types::{JobInfo, JobState};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Slot {
    info: JobInfo,
    cancel: Arc<CancelToken>,
}

#[derive(Default)]
pub struct JobRegistry {
    inner: Mutex<HashMap<String, Slot>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a freshly-started job. Returns the `CancelToken` the
    /// executor should consult so the registry's cancel call can flip
    /// the same flag.
    pub fn insert(&self, info: JobInfo) -> Arc<CancelToken> {
        let cancel = CancelToken::new();
        let slot = Slot {
            info: info.clone(),
            cancel: cancel.clone(),
        };
        self.inner
            .lock()
            .expect("job registry poisoned")
            .insert(info.id.clone(), slot);
        cancel
    }

    /// Update the lifecycle state of a job. No-op if the id is unknown.
    pub fn set_state(&self, id: &str, state: JobState) {
        if let Some(slot) = self
            .inner
            .lock()
            .expect("job registry poisoned")
            .get_mut(id)
        {
            slot.info.state = state;
        }
    }

    /// Flip a job's cancel token. Returns `true` if the job exists.
    pub fn cancel(&self, id: &str) -> bool {
        match self
            .inner
            .lock()
            .expect("job registry poisoned")
            .get(id)
        {
            Some(slot) => {
                slot.cancel.cancel();
                true
            }
            None => false,
        }
    }

    /// Pause a running job (executor blocks at the next inter-file
    /// checkpoint). Returns `true` if found.
    pub fn pause(&self, id: &str) -> bool {
        let mut g = self.inner.lock().expect("job registry poisoned");
        match g.get_mut(id) {
            Some(slot) => {
                slot.cancel.pause();
                slot.info.state = JobState::Paused;
                true
            }
            None => false,
        }
    }

    /// Resume a previously-paused job. Cancelled jobs are NOT
    /// resumable; this is intentional — once aborted, callers should
    /// start a fresh job. Returns `true` if the resume actually flips
    /// state (i.e. job exists and was paused).
    pub fn resume(&self, id: &str) -> bool {
        let mut g = self.inner.lock().expect("job registry poisoned");
        match g.get_mut(id) {
            Some(slot) if slot.info.state == JobState::Paused => {
                slot.cancel.resume();
                slot.info.state = JobState::Running;
                true
            }
            _ => false,
        }
    }

    /// List every known job. The frontend filters to the in-flight ones
    /// for the queue widget.
    pub fn list(&self) -> Vec<JobInfo> {
        self.inner
            .lock()
            .expect("job registry poisoned")
            .values()
            .map(|s| s.info.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str) -> JobInfo {
        JobInfo {
            id: id.into(),
            src: "/src".into(),
            dest: "/dest".into(),
            state: JobState::Planning,
        }
    }

    #[test]
    fn insert_then_list_includes_the_job() {
        let r = JobRegistry::new();
        r.insert(info("a"));
        assert_eq!(r.list().len(), 1);
    }

    #[test]
    fn set_state_updates_in_place() {
        let r = JobRegistry::new();
        r.insert(info("a"));
        r.set_state("a", JobState::Done);
        assert_eq!(r.list()[0].state, JobState::Done);
    }

    #[test]
    fn cancel_flips_the_token_and_returns_true() {
        let r = JobRegistry::new();
        let token = r.insert(info("a"));
        assert!(!token.is_cancelled());
        assert!(r.cancel("a"));
        assert!(token.is_cancelled());
    }

    #[test]
    fn cancel_returns_false_for_unknown_ids() {
        let r = JobRegistry::new();
        assert!(!r.cancel("nope"));
    }

    #[test]
    fn pause_flips_token_and_state() {
        let r = JobRegistry::new();
        let token = r.insert(info("a"));
        assert!(r.pause("a"));
        assert!(token.is_paused());
        assert_eq!(r.list()[0].state, JobState::Paused);
    }

    #[test]
    fn resume_only_unpauses_if_currently_paused() {
        let r = JobRegistry::new();
        let token = r.insert(info("a"));
        // Not paused yet — resume should be a no-op + return false.
        assert!(!r.resume("a"));
        // Pause then resume.
        r.pause("a");
        assert!(token.is_paused());
        assert!(r.resume("a"));
        assert!(!token.is_paused());
        assert_eq!(r.list()[0].state, JobState::Running);
    }

    #[test]
    fn pause_resume_unknown_id_returns_false() {
        let r = JobRegistry::new();
        assert!(!r.pause("missing"));
        assert!(!r.resume("missing"));
    }
}
