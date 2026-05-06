//! Filesystem layer. Phase 1 only ships the local backend; remote backends
//! (sftp / ftp / smb) will join here in subsequent phases behind a shared
//! `RemoteFs` trait. Until then, the public surface is the free functions in
//! [`local`] re-exported through Tauri commands in `crate::commands`.

pub mod icons;
pub mod local;
pub mod types;
