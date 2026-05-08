//! SFTP backend, built on `russh` + `russh-sftp` (pure-Rust, no libssh2 C
//! dependency). Phase 2a ships the read-only operations the preview pane
//! and listing already need; mkdir/rename/remove land in Phase 2b once we
//! have a docker-compose harness to integration-test the write path.
//!
//! Threading: a single `SftpSession` is wrapped in a `tokio::sync::Mutex`
//! because each command channel is single-flight. The registry holds an
//! `Arc<SftpClient>` so concurrent Tauri commands queue on the mutex
//! rather than racing.

use crate::fs::icons::kind_for_path;
use crate::fs::local::DirSummary;
use crate::fs::types::{Entry, FileKind, FsResult, ListOptions};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use russh::client::{Handle, Handler};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use tokio::io::AsyncWriteExt;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

/// Config the frontend sends to open a new SFTP connection. Auth is exactly
/// one of `password` or `private_key_path` (the credential validation lives
/// in [`SftpClient::connect`]). `known_host_pin` is the optional server-key
/// fingerprint pin; when `None` we currently accept any key (Phase 2b will
/// surface a TOFU prompt).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    /// Path to an OpenSSH private key file. Optional passphrase via
    /// `private_key_passphrase`.
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    /// When true, enumerate identities from `SSH_AUTH_SOCK` and try
    /// each in turn — same flow as `ssh -A` from a shell. Higher
    /// priority than password / private key when set, since users
    /// who run an agent prefer it.
    #[serde(default)]
    pub use_agent: bool,
}

fn default_port() -> u16 {
    22
}

/// Russh client handler. When `known_hosts_path` is `Some`, applies
/// trust-on-first-use semantics — record the SHA-256 fingerprint of
/// the server's public key on first connect, refuse on subsequent
/// connects whose key doesn't match. When `None`, accepts any key
/// (used by tests and explicit "accept all" mode).
struct TofuHandler {
    host: String,
    port: u16,
    known_hosts_path: Option<std::path::PathBuf>,
    /// Side channel for surfacing a mismatch up to the caller. The
    /// `Handler` trait can only return a bool; on mismatch we fill
    /// this in so `connect()` can raise a meaningful error instead
    /// of the generic russh "rejected" message.
    mismatch: Arc<std::sync::Mutex<Option<String>>>,
}

#[async_trait::async_trait]
impl Handler for TofuHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // No path = legacy accept-all mode (tests / explicit opt-out).
        let Some(path) = self.known_hosts_path.clone() else {
            return Ok(true);
        };
        let key_id = format!("{}:{}", self.host, self.port);
        let presented = server_public_key.fingerprint();

        // Best-effort load; a parse error treats it as if the file is
        // empty so the user can recover by re-trusting the host.
        let mut map = crate::fs::known_hosts::load(&path).unwrap_or_default();
        match crate::fs::known_hosts::check(&map, &key_id, &presented) {
            crate::fs::known_hosts::CheckOutcome::NewHost => {
                map.insert(key_id, presented);
                let _ = crate::fs::known_hosts::save(&path, &map);
                Ok(true)
            }
            crate::fs::known_hosts::CheckOutcome::Match => Ok(true),
            crate::fs::known_hosts::CheckOutcome::Mismatch {
                stored,
                presented,
            } => {
                *self.mismatch.lock().unwrap() = Some(format!(
                    "host key mismatch for {key_id}: stored SHA256:{stored}, presented SHA256:{presented}. Remove the entry from known_hosts.json and reconnect if you actually trust this change."
                ));
                Ok(false)
            }
        }
    }
}

/// Live SFTP connection. Constructed via [`SftpClient::connect`] and held by
/// the connection registry until disposed.
pub struct SftpClient {
    /// Holds the SFTP session behind a mutex — russh-sftp commands aren't
    /// `&mut self` but the protocol is single-flight per channel.
    sftp: Arc<Mutex<SftpSession>>,
    /// Keeps the underlying SSH session alive for the lifetime of the
    /// SftpClient. Dropping this drops the channel; the field is otherwise
    /// unused at runtime.
    _session: Handle<TofuHandler>,
}

impl SftpClient {
    /// Walk every identity in `SSH_AUTH_SOCK`, try each via the
    /// russh `authenticate_future` flow with the agent as the
    /// signer. Returns true on the first successful identity.
    /// Failures (no SSH_AUTH_SOCK, agent socket missing, no
    /// identities loaded) all coerce to false so the caller can
    /// fall through to password / private-key auth.
    async fn try_agent_auth(
        session: &mut russh::client::Handle<TofuHandler>,
        user: &str,
    ) -> Result<bool, String> {
        #[cfg(unix)]
        {
            use russh_keys::agent::client::AgentClient;
            let mut agent = match AgentClient::connect_env().await {
                Ok(a) => a,
                Err(e) => return Err(format!("ssh-agent connect: {e}")),
            };
            let identities = agent
                .request_identities()
                .await
                .map_err(|e| format!("ssh-agent identities: {e}"))?;
            for key in identities {
                let (returned, result) = session
                    .authenticate_future(user, key, agent)
                    .await;
                agent = returned;
                if result.unwrap_or(false) {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        #[cfg(not(unix))]
        {
            // Windows ssh-agent (named-pipe / Pageant) lives behind
            // a different transport. Skip cleanly and let the
            // configured password / private-key path handle it.
            let _ = (session, user);
            Ok(false)
        }
    }

    /// Open a new SFTP connection to `config.host:config.port` and
    /// authenticate. Errors flatten to strings on the way out — the
    /// frontend just shows them in a snackbar.
    ///
    /// Tests pass `known_hosts_path = None` to bypass TOFU. Production
    /// callers always pass `Some(app_data_dir.join("known_hosts.json"))`
    /// so unrecognized host-key changes refuse the handshake.
    pub async fn connect(
        config: SftpConfig,
        known_hosts_path: Option<std::path::PathBuf>,
    ) -> FsResult<Self> {
        let ssh_config = Arc::new(russh::client::Config {
            inactivity_timeout: Some(Duration::from_secs(300)),
            ..russh::client::Config::default()
        });

        let mismatch: Arc<std::sync::Mutex<Option<String>>> =
            Arc::new(std::sync::Mutex::new(None));
        let handler = TofuHandler {
            host: config.host.clone(),
            port: config.port,
            known_hosts_path,
            mismatch: Arc::clone(&mismatch),
        };

        let mut session = russh::client::connect(
            ssh_config,
            (config.host.as_str(), config.port),
            handler,
        )
        .await
        .map_err(|e| {
            // If the TOFU handler set a specific mismatch reason,
            // surface it instead of the generic russh "rejected".
            let reason = mismatch.lock().unwrap().take();
            match reason {
                Some(r) => r,
                None => format!("ssh connect: {e}"),
            }
        })?;

        // Auth dispatch — caller validates at-least-one upstream. ssh-agent
        // gets priority when enabled, mirroring `ssh -A` semantics; users
        // who took the trouble to load identities into their agent expect
        // those to be tried first. We fall back to password / private key
        // if the agent has no usable identity.
        let mut authenticated = false;
        if config.use_agent {
            authenticated =
                Self::try_agent_auth(&mut session, &config.user).await.unwrap_or(false);
        }
        if !authenticated {
            if let Some(pw) = &config.password {
                authenticated = session
                    .authenticate_password(&config.user, pw)
                    .await
                    .map_err(|e| format!("ssh auth (password): {e}"))?;
            } else if let Some(key_path) = &config.private_key_path {
                let key = russh_keys::load_secret_key(
                    key_path,
                    config.private_key_passphrase.as_deref(),
                )
                .map_err(|e| format!("load private key {key_path}: {e}"))?;
                authenticated = session
                    .authenticate_publickey(&config.user, Arc::new(key))
                    .await
                    .map_err(|e| format!("ssh auth (publickey): {e}"))?;
            } else if !config.use_agent {
                return Err(
                    "no auth method provided (password, private key, or use_agent required)"
                        .into(),
                );
            }
        }

        if !authenticated {
            return Err("ssh auth: rejected by server".into());
        }

        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("open channel: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("request sftp subsystem: {e}"))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("sftp init: {e}"))?;

        Ok(Self {
            sftp: Arc::new(Mutex::new(sftp)),
            _session: session,
        })
    }

    /// Convert a `FileAttributes` row into our shared `Entry` shape. Pulled
    /// out so list_dir / stat both run through the same mapping logic.
    fn entry_from_attrs(name: String, path: String, attrs: &FileAttributes) -> Entry {
        let is_dir = attrs.is_dir();
        let is_symlink = attrs.is_symlink();
        let kind = if is_dir {
            FileKind::Folder
        } else if is_symlink {
            FileKind::Symlink
        } else {
            kind_for_path(Path::new(&name))
        };
        // Hidden = leading-dot. SFTP doesn't have a separate flag.
        let is_hidden = name.starts_with('.') && name != "." && name != "..";

        Entry {
            name,
            path,
            kind,
            size: if is_dir { 0 } else { attrs.size.unwrap_or(0) },
            mtime: attrs.mtime.map(|t| t as i64),
            is_dir,
            is_symlink,
            is_hidden,
            mode: attrs.permissions,
        }
    }

    /// List immediate children of `path`. The russh-sftp iterator already
    /// drops `.` / `..` for us, so this is just an attribute mapping pass
    /// plus the hidden-file filter.
    pub async fn list_dir(&self, path: &str, opts: ListOptions) -> FsResult<Vec<Entry>> {
        let sftp = self.sftp.lock().await;
        let dir = sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("read_dir({path}): {e}"))?;

        let mut out = Vec::new();
        for entry in dir {
            let name = entry.file_name();
            let attrs = entry.metadata();
            let full = if path.ends_with('/') {
                format!("{path}{name}")
            } else {
                format!("{path}/{name}")
            };
            let e = Self::entry_from_attrs(name, full, &attrs);
            if !opts.show_hidden && e.is_hidden {
                continue;
            }
            out.push(e);
        }
        Ok(out)
    }

    /// Stat a single path. Used by the path bar.
    pub async fn stat(&self, path: &str) -> FsResult<Entry> {
        let sftp = self.sftp.lock().await;
        let attrs = sftp
            .metadata(path)
            .await
            .map_err(|e| format!("stat({path}): {e}"))?;
        let name = path.rsplit('/').next().unwrap_or(path).to_string();
        Ok(Self::entry_from_attrs(name, path.to_string(), &attrs))
    }

    /// Read the head of a file as UTF-8 (lossy). Used by the preview pane.
    pub async fn read_text(&self, path: &str, max_bytes: u64) -> FsResult<String> {
        let bytes = self.read_bytes_capped(path, max_bytes, false).await?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Read the entire file as base64. Refuses oversized inputs.
    pub async fn read_base64(&self, path: &str, max_bytes: u64) -> FsResult<String> {
        let bytes = self.read_bytes_capped(path, max_bytes, true).await?;
        Ok(B64.encode(bytes))
    }

    /// Internal helper. `strict_size_check = true` errors on oversized files
    /// (used for images — we'd rather fail than render half a frame);
    /// `false` truncates (used for text previews where head-only is fine).
    async fn read_bytes_capped(
        &self,
        path: &str,
        max_bytes: u64,
        strict_size_check: bool,
    ) -> FsResult<Vec<u8>> {
        let sftp = self.sftp.lock().await;
        let attrs = sftp
            .metadata(path)
            .await
            .map_err(|e| format!("stat({path}): {e}"))?;
        if attrs.is_dir() {
            return Err(format!("not a file: {path}"));
        }
        let size = attrs.size.unwrap_or(0);
        if strict_size_check && size > max_bytes {
            return Err(format!(
                "file too large for preview: {} bytes (limit {})",
                size, max_bytes
            ));
        }
        let mut file = sftp
            .open_with_flags(path, OpenFlags::READ)
            .await
            .map_err(|e| format!("open({path}): {e}"))?;
        let take = std::cmp::min(size, max_bytes) as usize;
        let mut buf = Vec::with_capacity(take);
        let mut chunk = [0u8; 64 * 1024];
        let mut total = 0;
        while total < take {
            let want = std::cmp::min(chunk.len(), take - total);
            let n = file
                .read(&mut chunk[..want])
                .await
                .map_err(|e| format!("read({path}): {e}"))?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            total += n;
        }
        Ok(buf)
    }

    /// Create a directory on the remote. The russh-sftp client surfaces
    /// `create_dir` as a single-level `MKDIR` — there's no recursive
    /// variant, so we walk parents ourselves and ignore "already exists"
    /// failures (matching the local fs flavor's idempotency).
    pub async fn mkdir(&self, path: &str) -> FsResult<()> {
        let sftp = self.sftp.lock().await;
        // Build the ancestor list (POSIX-only: SFTP paths are always /-separated).
        let mut parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        // Drop the leaf so we mkdir parents first, then the target itself.
        let leaf = parts.pop();
        let mut acc = String::new();
        for p in parts {
            acc.push('/');
            acc.push_str(p);
            // Server returns an error for "already exists" — swallow it.
            // We could call try_exists first but that's an extra round
            // trip; cheaper to attempt + ignore.
            let _ = sftp.create_dir(acc.clone()).await;
        }
        if let Some(leaf) = leaf {
            acc.push('/');
            acc.push_str(leaf);
            // Final segment: surface the real error if creation actually
            // fails (permissions, parent-not-a-dir, etc.).
            match sftp.create_dir(acc.clone()).await {
                Ok(()) => Ok(()),
                Err(e) => {
                    // If the path now exists as a directory, treat as
                    // success — we likely lost a race with another
                    // client, or the dir was already there.
                    match sftp.metadata(acc.clone()).await {
                        Ok(md) if md.is_dir() => Ok(()),
                        _ => Err(format!("mkdir({path}): {e}")),
                    }
                }
            }
        } else {
            // Empty/root path — nothing to do.
            Ok(())
        }
    }

    /// Move (or rename within the same dir). Same-FS only — for cross-
    /// device the engine should fall back to copy + remove, just like
    /// local.
    pub async fn rename(&self, from: &str, to: &str) -> FsResult<()> {
        let sftp = self.sftp.lock().await;
        sftp.rename(from, to)
            .await
            .map_err(|e| format!("rename({from} -> {to}): {e}"))
    }

    /// Open a remote file for reading. Returns the russh-sftp `File`
    /// which implements `tokio::io::AsyncRead` so the cross-engine can
    /// stream chunks rather than buffering the whole payload.
    ///
    /// Critically, the returned `File` outlives the lock guard: the
    /// underlying `SftpSession` is `Clone` and `open_with_flags`
    /// internally clones the session into the File. We can release the
    /// guard while still holding a working File. This is what lets the
    /// cross-engine pipeline reads + writes concurrently against the
    /// same SftpClient.
    pub async fn open_read(&self, path: &str) -> FsResult<russh_sftp::client::fs::File> {
        let sftp = self.sftp.lock().await;
        sftp.open_with_flags(path, OpenFlags::READ)
            .await
            .map_err(|e| format!("open_for_read({path}): {e}"))
    }

    /// Open a remote file for writing (create + truncate). Same
    /// outlives-the-lock argument as [`open_read`].
    pub async fn open_write(&self, path: &str) -> FsResult<russh_sftp::client::fs::File> {
        let sftp = self.sftp.lock().await;
        sftp.open_with_flags(
            path,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| format!("open_for_write({path}): {e}"))
    }

    /// Write a buffer as a remote file. Used by the cross-protocol
    /// engine when the destination is SFTP. Truncates if the file
    /// exists; the conflict-resolution layer is upstream.
    pub async fn write_full(&self, path: &str, data: &[u8]) -> FsResult<()> {
        let sftp = self.sftp.lock().await;
        let mut file = sftp
            .open_with_flags(
                path,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| format!("open_for_write({path}): {e}"))?;
        file.write_all(data)
            .await
            .map_err(|e| format!("write({path}): {e}"))?;
        file.flush()
            .await
            .map_err(|e| format!("flush({path}): {e}"))?;
        Ok(())
    }

    /// Recursive remove. SFTP's primitives are file vs dir-only, so we
    /// stat first and dispatch; for dirs we walk depth-first, removing
    /// children before the parent.
    pub async fn remove(&self, path: &str) -> FsResult<()> {
        let sftp = self.sftp.lock().await;
        let md = sftp
            .metadata(path)
            .await
            .map_err(|e| format!("stat({path}): {e}"))?;
        if !md.is_dir() {
            return sftp
                .remove_file(path)
                .await
                .map_err(|e| format!("remove_file({path}): {e}"))
        }
        // Iterative DFS post-order: collect every entry first, then
        // delete deepest-first. Symlinks inside the tree get removed as
        // links (we never follow them).
        let mut to_remove_files: Vec<String> = Vec::new();
        let mut to_remove_dirs: Vec<String> = vec![path.to_string()];
        let mut stack: Vec<String> = vec![path.to_string()];
        while let Some(dir) = stack.pop() {
            let listing = match sftp.read_dir(&dir).await {
                Ok(l) => l,
                // Unreadable subdir — try to rmdir it later anyway; if
                // it's actually populated, the rmdir errors will
                // surface.
                Err(_) => continue,
            };
            for entry in listing {
                let name = entry.file_name();
                let attrs = entry.metadata();
                let full = if dir.ends_with('/') {
                    format!("{dir}{name}")
                } else {
                    format!("{dir}/{name}")
                };
                if attrs.is_dir() && !attrs.is_symlink() {
                    to_remove_dirs.push(full.clone());
                    stack.push(full);
                } else {
                    to_remove_files.push(full);
                }
            }
        }
        for f in to_remove_files {
            sftp.remove_file(&f)
                .await
                .map_err(|e| format!("remove_file({f}): {e}"))?;
        }
        // Reverse so deepest dirs go first. The original `path` is at
        // index 0; we want it last.
        to_remove_dirs.reverse();
        for d in to_remove_dirs {
            sftp.remove_dir(&d)
                .await
                .map_err(|e| format!("remove_dir({d}): {e}"))?;
        }
        Ok(())
    }

    /// Recursive entries + size, capped at `max_entries`. Iterative so a
    /// deep tree doesn't blow the stack. Mirrors the local impl's shape.
    pub async fn dir_summary(&self, path: &str, max_entries: usize) -> FsResult<DirSummary> {
        let mut entries: u64 = 0;
        let mut total_size: u64 = 0;
        let mut stack: Vec<String> = vec![path.to_string()];
        let sftp = self.sftp.lock().await;
        while let Some(dir) = stack.pop() {
            let listing = match sftp.read_dir(&dir).await {
                Ok(l) => l,
                // Unreadable subdir (permissions) — keep going.
                Err(_) => continue,
            };
            for entry in listing {
                if entries as usize >= max_entries {
                    return Ok(DirSummary {
                        entries,
                        total_size,
                        truncated: true,
                    });
                }
                entries += 1;
                let attrs = entry.metadata();
                let full = if dir.ends_with('/') {
                    format!("{dir}{}", entry.file_name())
                } else {
                    format!("{dir}/{}", entry.file_name())
                };
                if attrs.is_dir() && !attrs.is_symlink() {
                    stack.push(full);
                } else {
                    total_size += attrs.size.unwrap_or(0);
                }
            }
        }
        Ok(DirSummary {
            entries,
            total_size,
            truncated: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // We can't run a real SFTP server in unit tests — that comes via the
    // docker-compose harness in Phase 3. These tests verify the pieces
    // that don't need network access: config parsing and the entry mapping.

    #[test]
    fn config_deserializes_with_camelcase() {
        let json = r#"{
            "host": "example.com",
            "port": 2222,
            "user": "alice",
            "password": "hunter2",
            "privateKeyPath": null,
            "privateKeyPassphrase": null
        }"#;
        let cfg: SftpConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.host, "example.com");
        assert_eq!(cfg.port, 2222);
        assert_eq!(cfg.user, "alice");
        assert_eq!(cfg.password.as_deref(), Some("hunter2"));
        assert!(cfg.private_key_path.is_none());
    }

    #[test]
    fn config_defaults_port_22() {
        let json = r#"{"host":"a","user":"b","password":"c"}"#;
        let cfg: SftpConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.port, 22);
    }

    /// Build a FileAttributes with `permissions` set to a unix-style
    /// type+mode. The library's `is_dir`/`is_symlink` consult that field.
    fn attrs_with(permissions: u32, size: Option<u64>) -> FileAttributes {
        let mut a = FileAttributes::default();
        a.permissions = Some(permissions);
        a.size = size;
        a
    }

    #[test]
    fn entry_from_attrs_maps_dir() {
        let a = attrs_with(0o040755, None);
        let e = SftpClient::entry_from_attrs("foo".into(), "/x/foo".into(), &a);
        assert!(e.is_dir);
        assert_eq!(e.kind, FileKind::Folder);
        assert_eq!(e.size, 0);
    }

    #[test]
    fn entry_from_attrs_classifies_markdown() {
        let a = attrs_with(0o100644, Some(1234));
        let e = SftpClient::entry_from_attrs("notes.md".into(), "/x/notes.md".into(), &a);
        assert!(!e.is_dir);
        assert_eq!(e.kind, FileKind::Markdown);
        assert_eq!(e.size, 1234);
    }

    #[test]
    fn entry_from_attrs_marks_dotfile_hidden() {
        let a = attrs_with(0o100644, Some(0));
        let e = SftpClient::entry_from_attrs(".env".into(), "/x/.env".into(), &a);
        assert!(e.is_hidden);
    }
}
