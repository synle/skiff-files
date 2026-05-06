//! Conflict resolver hub. When the engine hits a `Prompt`-policy
//! conflict it parks here until the frontend modal sends a decision.
//!
//! Implementation: a `Mutex<HashMap>` of `conflict_id → decision` plus
//! a `Condvar` to wake waiters. Engine waits with a 100 ms timeout so
//! it can re-check the cancel flag; once cancelled, the wait returns
//! `None` regardless of whether a decision arrived.

use super::engine::CancelToken;
use super::types::ConflictPromptDecision;
use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

/// Hub kept as Tauri-managed State (`Arc<ResolverHub>`). Single
/// instance shared by every running job; the `conflict_id` keyspace
/// is unique enough on its own (UUID v4) that we don't need per-job
/// shards.
#[derive(Default)]
pub struct ResolverHub {
    pending: Mutex<HashMap<String, ConflictPromptDecision>>,
    notify: Condvar,
}

impl ResolverHub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Block until `resolve(conflict_id, ...)` is called or `cancel`
    /// trips. Returns `None` on cancel; `Some(decision)` otherwise.
    pub fn wait_for(
        &self,
        conflict_id: &str,
        cancel: &CancelToken,
    ) -> Option<ConflictPromptDecision> {
        let mut g = self.pending.lock().expect("resolver poisoned");
        loop {
            if let Some(d) = g.remove(conflict_id) {
                return Some(d);
            }
            if cancel.is_cancelled() {
                return None;
            }
            // Re-check `cancel` every 100 ms so a Cancel-while-paused
            // unblocks responsively. The Condvar wakes us instantly on
            // `resolve`; the timeout is just for the cancel poll.
            let (next, _timeout) = self
                .notify
                .wait_timeout(g, Duration::from_millis(100))
                .expect("resolver wait poisoned");
            g = next;
        }
    }

    /// Deposit a decision and wake every waiter. The matching
    /// `wait_for` will pick its own conflict_id off the map; the
    /// other waiters re-park.
    pub fn resolve(&self, conflict_id: String, decision: ConflictPromptDecision) {
        let mut g = self.pending.lock().expect("resolver poisoned");
        g.insert(conflict_id, decision);
        self.notify.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn resolve_unblocks_wait_with_the_right_decision() {
        let hub = Arc::new(ResolverHub::new());
        let cancel = CancelToken::new();

        let hub_for_runner = hub.clone();
        let cancel_for_runner = cancel.clone();
        let runner = thread::spawn(move || {
            hub_for_runner.wait_for("c1", &cancel_for_runner)
        });

        thread::sleep(Duration::from_millis(50));
        hub.resolve("c1".into(), ConflictPromptDecision::Overwrite);
        let out = runner.join().unwrap();
        assert_eq!(out, Some(ConflictPromptDecision::Overwrite));
    }

    #[test]
    fn cancel_unblocks_wait_with_none() {
        let hub = Arc::new(ResolverHub::new());
        let cancel = CancelToken::new();

        let hub_for_runner = hub.clone();
        let cancel_for_runner = cancel.clone();
        let runner = thread::spawn(move || {
            hub_for_runner.wait_for("c1", &cancel_for_runner)
        });

        thread::sleep(Duration::from_millis(50));
        cancel.cancel();
        let out = runner.join().unwrap();
        assert!(out.is_none());
    }

    #[test]
    fn unrelated_resolve_does_not_wake_a_different_conflict_id() {
        let hub = Arc::new(ResolverHub::new());
        let cancel = CancelToken::new();

        let hub_for_runner = hub.clone();
        let cancel_for_runner = cancel.clone();
        let runner = thread::spawn(move || {
            hub_for_runner.wait_for("c-target", &cancel_for_runner)
        });

        // Resolve a different id — the runner should still be waiting.
        thread::sleep(Duration::from_millis(50));
        hub.resolve("c-other".into(), ConflictPromptDecision::Skip);
        thread::sleep(Duration::from_millis(50));

        // Only the matching resolve unblocks it.
        hub.resolve("c-target".into(), ConflictPromptDecision::KeepBoth);
        let out = runner.join().unwrap();
        assert_eq!(out, Some(ConflictPromptDecision::KeepBoth));
    }
}
