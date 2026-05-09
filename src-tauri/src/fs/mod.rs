//! Filesystem layer. Phase 1 shipped the local backend; Phase 2a adds the
//! SFTP backend in [`sftp`]. The two share `Entry` / `FileKind` / `DirSummary`
//! types so the frontend treats them interchangeably.

pub mod icons;
pub mod known_hosts;
pub mod local;
pub mod registry;
pub mod sftp;
pub mod ssh_config;
pub mod types;
pub mod watch;
