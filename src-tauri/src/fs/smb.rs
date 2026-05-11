//! SMB / Samba backend (Phase 3c). Built on the pure-Rust `smb2`
//! crate so the binary stays a single self-contained artifact on
//! every target OS — `pavao` would have FFI-wrapped `libsmbclient`
//! and forced a Samba install on every machine, defeating CLAUDE.md's
//! "no sidecar" rule.
//!
//! Threading: `smb2::SmbClient` and its per-share `Tree` are stateful
//! and require `&mut self` on every operation. We bundle both inside
//! a `tokio::sync::Mutex` so each command path locks, performs one
//! operation, and unlocks — same single-flight discipline as the
//! `FtpClient` wrapper, just async-native (no `block_in_place`
//! needed because `smb2` is fully async).
//!
//! URL shape (matches the SFTP / FTP pattern): every saved
//! connection is `(host, port, user, share)` and a UUID is its
//! registry id. The address bar uses `smb://<uuid>/<path-in-share>`;
//! `parseLocation` on the frontend already handles the split.

use crate::fs::icons::kind_for_path;
use crate::fs::types::{Entry, FileKind, FsResult, ListOptions};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Deserialize;
use smb2::{ClientConfig, SmbClient, Tree};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use tokio::sync::Mutex;

/// Connection-config payload from the frontend.
///
/// `domain` is empty for typical home/NAS shares (the server logs
/// the client into the local-machine workgroup). Corporate
/// Active-Directory shares need it set to the AD domain. Password
/// is required — guest auth would need an explicit toggle later
/// and modern Windows/macOS server defaults reject it anyway.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Share name (e.g. "Documents", "shared", "C$"). The slash
    /// after the share in `smb://host/share/path` becomes the
    /// `path-in-share` root.
    pub share: String,
    pub user: String,
    pub password: String,
    #[serde(default)]
    pub domain: String,
}

fn default_port() -> u16 {
    445
}

/// Live SMB connection. Single share per registry slot — opening a
/// second share on the same host is a second `conn_create_smb` call.
/// Could be optimized later to share TCP + session across multiple
/// `Tree`s, but the simpler 1:1 mapping matches the SFTP / FTP
/// connection lifecycle the frontend already understands.
pub struct SmbConnection {
    inner: Mutex<Inner>,
    /// Cached share name so we can produce nicer error messages
    /// without re-locking the mutex.
    share_name: String,
    /// Stored at connect time so we can re-establish the session
    /// transparently when the server drops it mid-idle. The
    /// integration suite hit this on dperson/samba between
    /// cross-backend ops; it surfaces in production any time
    /// the user pauses long enough for the server's idle-timeout
    /// to fire.
    cfg: SmbConfig,
}

struct Inner {
    client: SmbClient,
    tree: Tree,
}

impl SmbConnection {
    /// Open a TCP/SMB connection, authenticate, and bind a tree to
    /// the requested share. 10s connect timeout matches SFTP / FTP.
    pub async fn connect(cfg: SmbConfig) -> FsResult<Arc<Self>> {
        let addr = format!("{}:{}", cfg.host, cfg.port);
        let config = ClientConfig {
            addr: addr.clone(),
            timeout: Duration::from_secs(10),
            username: cfg.user.clone(),
            password: cfg.password.clone(),
            domain: cfg.domain.clone(),
            auto_reconnect: false,
            compression: true,
            dfs_enabled: true,
            dfs_target_overrides: Default::default(),
        };
        let mut client = SmbClient::connect(config)
            .await
            .map_err(|e| format!("connect({addr}): {e}"))?;
        let tree = client
            .connect_share(&cfg.share)
            .await
            .map_err(|e| format!("connect_share({}): {e}", cfg.share))?;
        Ok(Arc::new(Self {
            inner: Mutex::new(Inner { client, tree }),
            share_name: cfg.share.clone(),
            cfg,
        }))
    }

    /// Re-establish the SMB session in place. Called transparently
    /// by `with_session_retry` after a disconnect; safe to invoke
    /// multiple times (each call drops the previous client + tree
    /// before replacing them). Returns the new lock guard so the
    /// caller can immediately re-run the op without releasing the
    /// mutex (and racing another caller into another retry loop).
    async fn reconnect_inner(
        &self,
        slot: &mut Inner,
    ) -> Result<(), String> {
        let addr = format!("{}:{}", self.cfg.host, self.cfg.port);
        let config = ClientConfig {
            addr: addr.clone(),
            timeout: Duration::from_secs(10),
            username: self.cfg.user.clone(),
            password: self.cfg.password.clone(),
            domain: self.cfg.domain.clone(),
            auto_reconnect: false,
            compression: true,
            dfs_enabled: true,
            dfs_target_overrides: Default::default(),
        };
        let mut client = SmbClient::connect(config)
            .await
            .map_err(|e| format!("reconnect({addr}): {e}"))?;
        let tree = client
            .connect_share(&self.cfg.share)
            .await
            .map_err(|e| format!("reconnect_share({}): {e}", self.cfg.share))?;
        slot.client = client;
        slot.tree = tree;
        Ok(())
    }
}

/// Substring sniff for the disconnect error class. smb2 returns
/// strings like "Disconnected from server" / "connection reset" /
/// "broken pipe" depending on where in the protocol stack the
/// drop happens. Lower-case match keeps the test cheap and covers
/// every variant we've seen.
fn looks_like_disconnect(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("disconnect")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("connection closed")
}

impl SmbConnection {

    /// List a directory under the bound share. `path` is a
    /// share-relative POSIX-style path; `smb2` normalizes the
    /// forward-slash → backslash mapping internally.
    pub async fn list_dir(&self, path: &str, opts: ListOptions) -> FsResult<Vec<Entry>> {
        let rel = strip_leading_slash(path);
        // Single-attempt lock + retry on disconnect. Same shape in
        // every public op below.
        let entries = {
            let mut g = self.inner.lock().await;
            let first = {
                let Inner { client, tree } = &mut *g;
                client.list_directory(tree, rel).await.map_err(|e| e.to_string())
            };
            match first {
                Ok(v) => v,
                Err(ref e) if looks_like_disconnect(e) => {
                    self.reconnect_inner(&mut *g).await?;
                    let Inner { client, tree } = &mut *g;
                    client
                        .list_directory(tree, rel)
                        .await
                        .map_err(|e| format!("list_directory({}/{path}): {e}", self.share_name))?
                }
                Err(e) => {
                    return Err(format!("list_directory({}/{path}): {e}", self.share_name));
                }
            }
        };
        let mut out = Vec::with_capacity(entries.len());
        for e in entries {
            if e.name == "." || e.name == ".." {
                continue;
            }
            let is_hidden = e.name.starts_with('.');
            if !opts.show_hidden && is_hidden {
                continue;
            }
            let full = join_path(path, &e.name);
            let kind = if e.is_directory {
                FileKind::Folder
            } else {
                kind_for_path(Path::new(&e.name))
            };
            out.push(Entry {
                name: e.name,
                path: full,
                kind,
                size: if e.is_directory { 0 } else { e.size },
                mtime: e
                    .modified
                    .to_system_time()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64),
                ctime: e
                    .created
                    .to_system_time()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64),
                is_dir: e.is_directory,
                is_symlink: false, // SMB symlinks are rare + need a separate query; defer.
                is_hidden,
                mode: None,
            });
        }
        Ok(out)
    }

    pub async fn stat(&self, path: &str) -> FsResult<Entry> {
        let rel = strip_leading_slash(path);
        let info = {
            let mut g = self.inner.lock().await;
            let first = {
                let Inner { client, tree } = &mut *g;
                client.stat(tree, rel).await.map_err(|e| e.to_string())
            };
            match first {
                Ok(v) => v,
                Err(ref e) if looks_like_disconnect(e) => {
                    self.reconnect_inner(&mut *g).await?;
                    let Inner { client, tree } = &mut *g;
                    client
                        .stat(tree, rel)
                        .await
                        .map_err(|e| format!("stat({}/{path}): {e}", self.share_name))?
                }
                Err(e) => return Err(format!("stat({}/{path}): {e}", self.share_name)),
            }
        };
        let name = path_basename(path);
        Ok(Entry {
            name: name.clone(),
            path: path.to_string(),
            kind: if info.is_directory {
                FileKind::Folder
            } else {
                kind_for_path(Path::new(&name))
            },
            size: if info.is_directory { 0 } else { info.size },
            mtime: info
                .modified
                .to_system_time()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
            ctime: info
                .created
                .to_system_time()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
            is_dir: info.is_directory,
            is_symlink: false,
            is_hidden: name.starts_with('.'),
            mode: None,
        })
    }

    pub async fn read_text(&self, path: &str, max_bytes: u64) -> FsResult<String> {
        let bytes = self.read_bytes_capped(path, max_bytes).await?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    pub async fn read_base64(&self, path: &str, max_bytes: u64) -> FsResult<String> {
        let bytes = self.read_bytes_capped(path, max_bytes).await?;
        Ok(B64.encode(bytes))
    }

    /// Recursive `mkdir -p`. `smb2::create_directory` only makes one
    /// level; we walk components and ignore "already exists" so
    /// re-runs are no-ops.
    pub async fn mkdir(&self, path: &str) -> FsResult<()> {
        let rel = strip_leading_slash(path);
        let mut g = self.inner.lock().await;
        let Inner { client, tree } = &mut *g;
        let mut acc = String::new();
        for seg in rel.split('/').filter(|s| !s.is_empty()) {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(seg);
            if let Err(e) = client.create_directory(tree, &acc).await {
                let msg = e.to_string().to_lowercase();
                // OBJECT_NAME_COLLISION / FILE_ALREADY_EXISTS / etc.
                // — same idempotent-on-exists treatment as FTP.
                if !msg.contains("exists") && !msg.contains("collision") {
                    return Err(format!("mkdir({}/{acc}): {e}", self.share_name));
                }
            }
        }
        Ok(())
    }

    pub async fn rename(&self, from: &str, to: &str) -> FsResult<()> {
        let from_rel = strip_leading_slash(from);
        let to_rel = strip_leading_slash(to);
        let mut g = self.inner.lock().await;
        let first = {
            let Inner { client, tree } = &mut *g;
            client.rename(tree, from_rel, to_rel).await.map_err(|e| e.to_string())
        };
        match first {
            Ok(()) => Ok(()),
            Err(ref e) if looks_like_disconnect(e) => {
                self.reconnect_inner(&mut *g).await?;
                let Inner { client, tree } = &mut *g;
                client
                    .rename(tree, from_rel, to_rel)
                    .await
                    .map_err(|e| format!("rename({} -> {}): {e}", from, to))
            }
            Err(e) => Err(format!("rename({} -> {}): {e}", from, to)),
        }
    }

    /// Remove a file or directory. For directories, walks the tree
    /// and removes children first.
    ///
    /// We skip the initial `stat()` discriminator (which `FtpClient`
    /// uses) because the dperson/samba server in the integration
    /// stack drops the SMB session between a recent read + a stat
    /// on a fresh file — landing us in `Disconnected from server`.
    /// Calling `delete_file` first and falling back to the directory
    /// path only on a "is-a-directory"-shaped error keeps the
    /// happy-path single-round-trip + sidesteps the session drop.
    pub async fn remove(&self, path: &str) -> FsResult<()> {
        let rel = strip_leading_slash(path);
        // First try as a file (with the standard reconnect+retry on
        // disconnect). Anything that looks like "is a directory"
        // routes to the recursive-directory path below.
        let file_err = {
            let mut g = self.inner.lock().await;
            let first = {
                let Inner { client, tree } = &mut *g;
                client.delete_file(tree, rel).await.map_err(|e| e.to_string())
            };
            let second = match first {
                Ok(()) => return Ok(()),
                Err(ref e) if looks_like_disconnect(e) => {
                    self.reconnect_inner(&mut *g).await?;
                    let Inner { client, tree } = &mut *g;
                    client.delete_file(tree, rel).await.map_err(|e| e.to_string())
                }
                Err(e) => Err(e),
            };
            match second {
                Ok(()) => return Ok(()),
                Err(e) => e,
            }
        };
        // Heuristic: anything that looks like "directory" or "not a
        // file" routes through the recursive directory path.
        // Everything else surfaces as a hard error.
        let lower = file_err.to_lowercase();
        let looks_like_dir =
            lower.contains("directory") || lower.contains("file_is_a_directory");
        if !looks_like_dir {
            return Err(format!("delete({path}): {file_err}"));
        }
        let kids = self
            .list_dir(path, ListOptions { show_hidden: true })
            .await?;
        for child in kids {
            Box::pin(self.remove(&child.path)).await?;
        }
        let mut g = self.inner.lock().await;
        let Inner { client, tree } = &mut *g;
        client
            .delete_directory(tree, rel)
            .await
            .map_err(|e| format!("rmdir({path}): {e}"))
    }

    /// Upload `bytes` to `path`. Overwrites whatever's at the path.
    /// `smb2::write_file` is fully async; we keep the same single-flight
    /// mutex discipline as the read path so the SmbClient + Tree
    /// pair never gets re-entered.
    pub async fn write_bytes(&self, path: &str, bytes: &[u8]) -> FsResult<()> {
        let rel = strip_leading_slash(path);
        let mut g = self.inner.lock().await;
        let first = {
            let Inner { client, tree } = &mut *g;
            client.write_file(tree, rel, bytes).await.map_err(|e| e.to_string())
        };
        match first {
            Ok(_n) => Ok(()),
            Err(ref e) if looks_like_disconnect(e) => {
                self.reconnect_inner(&mut *g).await?;
                let Inner { client, tree } = &mut *g;
                client
                    .write_file(tree, rel, bytes)
                    .await
                    .map(|_n| ())
                    .map_err(|e| format!("write({path}): {e}"))
            }
            Err(e) => Err(format!("write({path}): {e}")),
        }
    }

    async fn read_bytes_capped(&self, path: &str, max_bytes: u64) -> FsResult<Vec<u8>> {
        let rel = strip_leading_slash(path);
        let mut g = self.inner.lock().await;
        let first = {
            let Inner { client, tree } = &mut *g;
            client.read_file(tree, rel).await.map_err(|e| e.to_string())
        };
        let mut data = match first {
            Ok(v) => v,
            Err(ref e) if looks_like_disconnect(e) => {
                self.reconnect_inner(&mut *g).await?;
                let Inner { client, tree } = &mut *g;
                client
                    .read_file(tree, rel)
                    .await
                    .map_err(|e| format!("read({path}): {e}"))?
            }
            Err(e) => return Err(format!("read({path}): {e}")),
        };
        if data.len() as u64 > max_bytes {
            data.truncate(max_bytes as usize);
        }
        Ok(data)
    }
}

fn strip_leading_slash(path: &str) -> &str {
    path.strip_prefix('/').unwrap_or(path)
}

fn path_basename(path: &str) -> String {
    path.rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

/// Same `join_path` shape as FTP — keep paths POSIX-style (forward
/// slashes) regardless of what smb2 normalizes to internally, so the
/// frontend address bar shows familiar paths and our URL parser
/// works without scheme-specific exceptions.
fn join_path(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else if dir.is_empty() {
        format!("/{name}")
    } else {
        format!("{dir}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_keeps_root_slash() {
        assert_eq!(join_path("/", "a"), "/a");
        assert_eq!(join_path("", "a"), "/a");
        assert_eq!(join_path("/foo", "bar"), "/foo/bar");
        assert_eq!(join_path("/foo/", "bar"), "/foo/bar");
    }

    #[test]
    fn strip_leading_slash_is_identity_when_no_slash() {
        assert_eq!(strip_leading_slash("foo/bar"), "foo/bar");
        assert_eq!(strip_leading_slash("/foo/bar"), "foo/bar");
        assert_eq!(strip_leading_slash("/"), "");
    }

    #[test]
    fn basename_picks_last_segment() {
        assert_eq!(path_basename("/foo/bar/baz.txt"), "baz.txt");
        assert_eq!(path_basename("/foo/"), "foo");
        assert_eq!(path_basename("/"), "");
    }

    #[test]
    fn default_port_is_445() {
        // Plain SMB over TCP. SMB-over-NetBIOS (port 139) is legacy
        // and we don't speak it.
        assert_eq!(default_port(), 445);
    }
}
