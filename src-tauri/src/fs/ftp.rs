//! FTP backend, built on `suppaftp` (pure-Rust). Phase 3a slice —
//! anonymous + user/password auth, list/stat/read for browsing
//! public FTP mirrors and authenticated drops. Write operations
//! (mkdir / rename / remove / upload) and FTPS land in Phase 3b
//! together with the docker-compose harness that tests them
//! against `vsftpd`.
//!
//! Threading: `suppaftp`'s default `FtpStream` is synchronous, so
//! we wrap the connection in a `tokio::sync::Mutex` + `spawn_blocking`
//! on every call. Single-flight is fine — the protocol itself is
//! command/response, no concurrent commands on one control channel.
//! Same pattern as `russh-sftp` from the caller's perspective.

use crate::fs::icons::kind_for_path;
use crate::fs::types::{Entry, FileKind, FsResult, ListOptions};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Deserialize;
use std::net::ToSocketAddrs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use suppaftp::FtpStream;
use tokio::sync::Mutex;

/// Connection-config payload from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Default `"anonymous"` for the typical public-mirror flow.
    #[serde(default = "default_user")]
    pub user: String,
    /// FTP convention: anonymous logins send an email address as the
    /// password. We default to `"anonymous@"`. Real auth callers
    /// override.
    #[serde(default = "default_password")]
    pub password: String,
}

fn default_port() -> u16 {
    21
}
fn default_user() -> String {
    "anonymous".to_string()
}
fn default_password() -> String {
    "anonymous@".to_string()
}

/// Live FTP connection. Wrap in `Arc<>` and hand out from the
/// registry — every command path locks the mutex for the duration
/// of its operation. Plain FTP only at this stage; FTPS goes
/// through the same struct once Phase 3b adds a `secure` flag.
pub struct FtpClient {
    stream: Mutex<FtpStream>,
}

impl FtpClient {
    /// Open a control connection + log in. Synchronous work runs on
    /// the blocking pool so the Tauri command thread doesn't stall
    /// waiting for the TCP handshake.
    pub async fn connect(cfg: FtpConfig) -> FsResult<Arc<Self>> {
        let stream = tokio::task::spawn_blocking(move || -> Result<FtpStream, String> {
            // 10s connect timeout matches what SFTP does. FTP servers
            // tend to be punctual; anything slower is broken.
            let addr = format!("{}:{}", cfg.host, cfg.port);
            let socket = addr
                .to_socket_addrs()
                .map_err(|e| format!("resolve({addr}): {e}"))?
                .next()
                .ok_or_else(|| format!("resolve({addr}): no addresses"))?;
            let mut s = FtpStream::connect_timeout(socket, Duration::from_secs(10))
                .map_err(|e| format!("connect({addr}): {e}"))?;
            s.login(&cfg.user, &cfg.password)
                .map_err(|e| format!("login({}): {e}", cfg.user))?;
            // Passive mode default — works behind NAT, which most
            // user machines are. Active mode would need an inbound
            // port on the client side.
            s.set_mode(suppaftp::types::Mode::Passive);
            Ok(s)
        })
        .await
        .map_err(|e| format!("FTP connect task: {e}"))??;

        Ok(Arc::new(Self {
            stream: Mutex::new(stream),
        }))
    }

    /// Best-effort disconnect. Errors here are swallowed because the
    /// registry has already dropped its `Arc<Self>` by the time this
    /// runs.
    pub async fn disconnect(self: Arc<Self>) {
        // `self` is the only strong ref by the time disconnect is
        // called; pull the inner mutex out via try_unwrap.
        let Ok(this) = Arc::try_unwrap(self) else {
            // Someone still holds a reference — leak the
            // connection instead of blocking shutdown.
            return;
        };
        let mut stream = this.stream.into_inner();
        let _ = tokio::task::spawn_blocking(move || stream.quit()).await;
    }

    /// List a directory. `LIST` is the human-readable form; `MLSD`
    /// would be cleaner but isn't universal. We parse the LIST
    /// output with suppaftp's `list` helper, which normalizes to a
    /// list of strings — then `suppaftp::list::File` does the
    /// per-line parse.
    pub async fn list_dir(
        &self,
        path: &str,
        opts: ListOptions,
    ) -> FsResult<Vec<Entry>> {
        let path = path.to_string();
        let mut stream = self.stream.lock().await;
        // suppaftp's `list` consumes a `&str` directory + returns
        // already-parsed lines. We move the stream into the blocking
        // task and put it back after.
        let result = tokio::task::block_in_place(|| {
            let lines = stream
                .list(Some(&path))
                .map_err(|e| format!("list({path}): {e}"))?;
            let mut out = Vec::new();
            for line in lines {
                let parsed = match suppaftp::list::File::try_from(line.as_str()) {
                    Ok(f) => f,
                    Err(_) => continue, // skip un-parseable lines (banners, etc.)
                };
                let name = parsed.name().to_string();
                if name == "." || name == ".." {
                    continue;
                }
                let full = join_path(&path, &name);
                let is_hidden = name.starts_with('.');
                if !opts.show_hidden && is_hidden {
                    continue;
                }
                let kind = if parsed.is_directory() {
                    FileKind::Folder
                } else if parsed.is_symlink() {
                    // Symlinks listed by FTP rarely tell us their
                    // target's kind — best-effort by extension.
                    kind_for_path(Path::new(&name))
                } else {
                    kind_for_path(Path::new(&name))
                };
                out.push(Entry {
                    name,
                    path: full,
                    kind,
                    size: parsed.size() as u64,
                    // FTP modtime resolution varies by server — we
                    // get a SystemTime if MDTM was issued, but
                    // `list` only carries the LIST line's
                    // timestamp. Skip for now; mtime stays None.
                    mtime: None,
                    ctime: None,
                    is_dir: parsed.is_directory(),
                    is_symlink: parsed.is_symlink(),
                    is_hidden,
                    mode: None,
                });
            }
            Ok::<Vec<Entry>, String>(out)
        });
        result
    }

    /// Stat a single path. FTP doesn't have a STAT-by-path that's
    /// reliable across servers — we list the parent + look up by
    /// name. Cheap on small directories, slow on huge ones; same
    /// tradeoff as SFTP's parent-listing fallback for similar
    /// servers.
    pub async fn stat(&self, path: &str) -> FsResult<Entry> {
        let (parent, name) = match path.rsplit_once('/') {
            Some((p, n)) if !n.is_empty() => {
                (if p.is_empty() { "/" } else { p }.to_string(), n.to_string())
            }
            _ => return Err(format!("stat({path}): can't split path")),
        };
        let entries = self
            .list_dir(
                &parent,
                ListOptions {
                    show_hidden: true,
                },
            )
            .await?;
        entries
            .into_iter()
            .find(|e| e.name == name)
            .ok_or_else(|| format!("stat({path}): not found"))
    }

    /// Read the head of a file as UTF-8 (lossy). 256 KB cap is the
    /// same one PreviewPane uses for text previews.
    pub async fn read_text(&self, path: &str, max_bytes: u64) -> FsResult<String> {
        let bytes = self.read_bytes_capped(path, max_bytes).await?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Read the entire file as base64. Used by image preview /
    /// thumbnail fallback for remote files.
    pub async fn read_base64(&self, path: &str, max_bytes: u64) -> FsResult<String> {
        let bytes = self.read_bytes_capped(path, max_bytes).await?;
        Ok(B64.encode(bytes))
    }

    /// Recursive `mkdir -p`. FTP's `MKD` only creates a single level,
    /// so we walk the path components and ignore "already exists"
    /// failures the same way SFTP does. Most servers respond
    /// `550 File exists` for that case — we sniff on the substring
    /// rather than parse the FTP reply code because servers vary.
    pub async fn mkdir(&self, path: &str) -> FsResult<()> {
        let path = path.to_string();
        let mut stream = self.stream.lock().await;
        tokio::task::block_in_place(|| -> FsResult<()> {
            // Walk components, building the prefix one segment at a
            // time. We treat any failure that mentions "exists" /
            // "550" as a non-error so this stays idempotent.
            let mut acc = String::new();
            for seg in path.split('/').filter(|s| !s.is_empty()) {
                if !acc.ends_with('/') {
                    acc.push('/');
                }
                acc.push_str(seg);
                if let Err(e) = stream.mkdir(&acc) {
                    let msg = e.to_string().to_lowercase();
                    if !msg.contains("exist") && !msg.contains("550") {
                        return Err(format!("mkdir({acc}): {e}"));
                    }
                }
            }
            Ok(())
        })
    }

    /// Rename / same-server move via FTP's `RNFR` + `RNTO`. suppaftp
    /// exposes this as a single `rename` call — works for both files
    /// and directories on servers that honor the standard. Same-FS
    /// moves only; cross-server moves go through Skiffsync.
    pub async fn rename(&self, from: &str, to: &str) -> FsResult<()> {
        let from = from.to_string();
        let to = to.to_string();
        let mut stream = self.stream.lock().await;
        tokio::task::block_in_place(|| {
            stream
                .rename(&from, &to)
                .map_err(|e| format!("rename({from} -> {to}): {e}"))
        })
    }

    /// Remove a file (DELE) or directory (RMD). We stat the path
    /// first to pick the right command since FTP has separate verbs.
    /// Directory removal is non-recursive — we walk the listing
    /// ourselves to mirror SFTP's behavior. There's no server-side
    /// trash; this is a permanent delete and the frontend should
    /// confirm before invoking.
    pub async fn remove(&self, path: &str) -> FsResult<()> {
        // The recursion happens at the application layer, not inside
        // the locked stream, so each iteration grabs + releases the
        // mutex. Cheap enough — directory trees are usually shallow.
        let entry = self.stat(path).await?;
        if entry.is_dir {
            // Walk children + recurse before removing the parent.
            let kids = self
                .list_dir(
                    path,
                    ListOptions {
                        show_hidden: true,
                    },
                )
                .await?;
            for child in kids {
                Box::pin(self.remove(&child.path)).await?;
            }
            let path = path.to_string();
            let mut stream = self.stream.lock().await;
            tokio::task::block_in_place(|| {
                stream
                    .rmdir(&path)
                    .map_err(|e| format!("rmdir({path}): {e}"))
            })?;
        } else {
            let path = path.to_string();
            let mut stream = self.stream.lock().await;
            tokio::task::block_in_place(|| {
                stream
                    .rm(&path)
                    .map_err(|e| format!("rm({path}): {e}"))
            })?;
        }
        Ok(())
    }

    /// Internal: pull `max_bytes` into memory. FTP's `retr` returns
    /// an opaque cursor — we drain it bytewise + cap at the limit
    /// (truncate rather than error, mirrors SFTP text-preview
    /// behavior).
    async fn read_bytes_capped(
        &self,
        path: &str,
        max_bytes: u64,
    ) -> FsResult<Vec<u8>> {
        let path = path.to_string();
        let mut stream = self.stream.lock().await;
        tokio::task::block_in_place(|| {
            stream
                .retr(&path, |reader| {
                    let mut buf: Vec<u8> = Vec::new();
                    let mut chunk = [0u8; 64 * 1024];
                    while (buf.len() as u64) < max_bytes {
                        let want = std::cmp::min(
                            chunk.len(),
                            (max_bytes - buf.len() as u64) as usize,
                        );
                        let n = reader.read(&mut chunk[..want]).map_err(|e| {
                            suppaftp::FtpError::ConnectionError(e)
                        })?;
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    Ok(buf)
                })
                .map_err(|e| format!("retr({path}): {e}"))
        })
    }
}

/// POSIX-style join that copes with the trailing slash on `/`.
fn join_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_path_handles_root_and_inner() {
        assert_eq!(join_path("/", "a"), "/a");
        assert_eq!(join_path("/", "a.txt"), "/a.txt");
        assert_eq!(join_path("/pub", "linux"), "/pub/linux");
        assert_eq!(join_path("/pub/", "linux"), "/pub/linux");
    }

    #[test]
    fn defaults_match_anonymous_convention() {
        // Anonymous-FTP convention: user "anonymous", password is an
        // email address — most servers accept anything resembling
        // user@. We default to "anonymous@" which is the minimal
        // valid form. Pin it so a future refactor doesn't silently
        // change the default to a non-functional value.
        assert_eq!(default_user(), "anonymous");
        assert_eq!(default_password(), "anonymous@");
        assert_eq!(default_port(), 21);
    }
}
