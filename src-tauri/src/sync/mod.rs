//! Skiffsync engine. Phase 4a is the MVP: local-to-local copy jobs with
//! skip-if-unchanged (size heuristic), three conflict policies, cancel,
//! and per-file progress events. Cross-protocol (sftp/ftp/smb), pause/
//! resume, and the TeraCopy-style smart-batch conflict dialog land in
//! Phase 4b.

pub mod backend;
pub mod cross_engine;
pub mod dedup;
pub mod engine;
pub mod plan;
pub mod registry;
pub mod repo;
pub mod resolver;
pub mod stamp;
pub mod types;
