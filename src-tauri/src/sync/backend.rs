//! Backend abstraction for the cross-protocol sync engine. Each
//! variant exposes the same async surface so the cross-engine can copy
//! between any pair without the per-step branching that plagues the
//! local-only engine.
//!
//! Phase 0.2.0 ships Local + Sftp. FTP / SMB join here in 0.2.1 / 0.2.2
//! once those backends exist; the cross-engine never has to change to
//! pick them up — `Backend::Ftp(...)`, `Backend::Smb(...)` slot in.

use crate::fs::sftp::SftpClient;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};

/// What the backend reports for a single path. Shared shape regardless
/// of protocol so the cross-engine's conflict-resolution + skip-if-
/// unchanged code can compare apples to apples.
#[derive(Debug, Clone, Copy, Default)]
pub struct PathMeta {
    pub size: u64,
    pub mtime: Option<i64>,
    pub is_dir: bool,
    pub is_symlink: bool,
}

/// Backend handle. The `Sftp` variant carries the registry's
/// `Arc<SftpClient>` so the cross-engine doesn't have to thread the
/// connection registry through every call.
#[derive(Clone)]
pub enum Backend {
    Local,
    Sftp(Arc<SftpClient>),
}

impl Backend {
    /// Stat a single path. Returns `None` if the path doesn't exist —
    /// errors come back as `Err`. We split "not found" out so the
    /// conflict checker can treat missing-dest as "no conflict, just
    /// copy" without inspecting an error string.
    pub async fn metadata(&self, path: &str) -> Result<Option<PathMeta>, String> {
        match self {
            Backend::Local => {
                let p = Path::new(path);
                match std::fs::symlink_metadata(p) {
                    Ok(md) => Ok(Some(PathMeta {
                        size: md.len(),
                        mtime: md
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64),
                        is_dir: md.is_dir(),
                        is_symlink: md.file_type().is_symlink(),
                    })),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(e) => Err(format!("stat({path}): {e}")),
                }
            }
            Backend::Sftp(client) => match client.stat(path).await {
                Ok(entry) => Ok(Some(PathMeta {
                    size: entry.size,
                    mtime: entry.mtime,
                    is_dir: entry.is_dir,
                    is_symlink: entry.is_symlink,
                })),
                // SftpClient currently flattens errors to strings — we
                // can't tell "not found" apart from other failures
                // without parsing. For now, treat any error as None so
                // the engine treats it as "no existing dest".
                // TODO(0.2.x): typed SFTP errors.
                Err(_) => Ok(None),
            },
        }
    }

    /// Read a whole file. Capped at `max_bytes` — the cross-engine
    /// streams via `read_chunked` for large files; this is here for the
    /// per-file conflict-resolution path that needs the full payload.
    pub async fn read_full(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        match self {
            Backend::Local => {
                let md = std::fs::metadata(path)
                    .map_err(|e| format!("stat({path}): {e}"))?;
                if md.len() > max_bytes {
                    return Err(format!(
                        "file too large for in-memory read: {} bytes (limit {})",
                        md.len(),
                        max_bytes
                    ));
                }
                std::fs::read(path).map_err(|e| format!("read({path}): {e}"))
            }
            Backend::Sftp(client) => {
                // The SftpClient has read_base64 (returns base64 string);
                // for cross-engine we want raw bytes. Use russh-sftp's
                // open + read directly on the inner session.
                use base64::engine::general_purpose::STANDARD as B64;
                use base64::Engine as _;
                let b64 = client.read_base64(path, max_bytes).await?;
                B64.decode(b64)
                    .map_err(|e| format!("decode base64({path}): {e}"))
            }
        }
    }

    /// Write a whole file. Creates parent directories as needed.
    pub async fn write_full(&self, path: &str, data: &[u8]) -> Result<(), String> {
        match self {
            Backend::Local => {
                let p = Path::new(path);
                if let Some(parent) = p.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(p, data).map_err(|e| format!("write({path}): {e}"))
            }
            Backend::Sftp(client) => {
                // Make the parent dir on the remote side first; SFTP
                // rejects writes into missing dirs.
                if let Some(parent) = parent_posix(path) {
                    if !parent.is_empty() {
                        client.mkdir(&parent).await?;
                    }
                }
                client.write_full(path, data).await
            }
        }
    }

    /// Recursively create a directory.
    pub async fn mkdir_p(&self, path: &str) -> Result<(), String> {
        match self {
            Backend::Local => std::fs::create_dir_all(path)
                .map_err(|e| format!("mkdir_p({path}): {e}")),
            Backend::Sftp(client) => client.mkdir(path).await,
        }
    }

    /// Rename / same-FS move within a single backend. Cross-backend
    /// rename is a copy + remove; the cross-engine handles that path.
    pub async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        match self {
            Backend::Local => std::fs::rename(from, to)
                .map_err(|e| format!("rename({from} -> {to}): {e}")),
            Backend::Sftp(client) => client.rename(from, to).await,
        }
    }

    /// Stream-copy `src_path` from this backend to `dest_path` on
    /// `dest`. Removes the in-memory cap that `read_full` / `write_full`
    /// imposed in 0.2.0; arbitrary-size files are copied in 64 KB
    /// chunks via `tokio::io::copy`. Local-to-local short-circuits to
    /// `std::fs::copy` so the kernel-accelerated path
    /// (`copy_file_range` / `clonefile`) keeps working.
    ///
    /// `bandwidth_kbps` of `0` means unlimited; any positive value
    /// forces the chunked path so we can interleave sleeps and pace
    /// the copy. Returns the bytes written.
    pub async fn copy_file(
        &self,
        src_path: &str,
        dest: &Backend,
        dest_path: &str,
        bandwidth_kbps: u64,
    ) -> Result<u64, String> {
        // Fast path: local→local without a bandwidth cap. Picks up
        // `clonefile` on macOS, `FICLONE` on Linux btrfs/xfs, etc. —
        // no userspace bytes shuffled.
        if matches!(self, Backend::Local)
            && matches!(dest, Backend::Local)
            && bandwidth_kbps == 0
        {
            // Make the parent dir before std::fs::copy so a copy into
            // a fresh subtree doesn't fail with NotFound.
            if let Some(parent) = Path::new(dest_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            // Match the local engine's cross-device fallback: if the
            // accelerated path returns EPERM (NFS / SMB mounts on
            // Linux), fall back to read+write. We don't get the bytes
            // count from the fallback path, so estimate from the
            // source file size.
            return match std::fs::copy(src_path, dest_path) {
                Ok(n) => Ok(n),
                Err(_) => {
                    let bytes = std::fs::read(src_path)
                        .map_err(|e| format!("read({src_path}): {e}"))?;
                    let len = bytes.len() as u64;
                    std::fs::write(dest_path, bytes)
                        .map_err(|e| format!("write({dest_path}): {e}"))?;
                    Ok(len)
                }
            };
        }

        // Streaming path. Make sure the dest's parent exists first
        // (every supported backend errors writing to a missing dir).
        if let Some(parent) = parent_posix(dest_path) {
            if !parent.is_empty() {
                dest.mkdir_p(&parent).await?;
            }
        }
        let mut reader = self.open_read(src_path).await?;
        let mut writer = dest.open_write(dest_path).await?;
        let bytes = if bandwidth_kbps == 0 {
            tokio::io::copy(&mut reader, &mut writer)
                .await
                .map_err(|e| format!("copy({src_path} -> {dest_path}): {e}"))?
        } else {
            copy_throttled_async(
                &mut reader,
                &mut writer,
                bandwidth_kbps,
                src_path,
                dest_path,
            )
            .await?
        };
        // SFTP needs an explicit shutdown to flush the final packet —
        // the local sink is a no-op shutdown.
        writer
            .shutdown()
            .await
            .map_err(|e| format!("shutdown({dest_path}): {e}"))?;
        Ok(bytes)
    }

    /// Open a streaming reader. The Box is `Send + Unpin` so callers
    /// can pass it straight to `tokio::io::copy`.
    pub async fn open_read(
        &self,
        path: &str,
    ) -> Result<Pin<Box<dyn AsyncRead + Send>>, String> {
        match self {
            Backend::Local => {
                let f = tokio::fs::File::open(path)
                    .await
                    .map_err(|e| format!("open({path}): {e}"))?;
                Ok(Box::pin(f))
            }
            Backend::Sftp(client) => {
                let f = client.open_read(path).await?;
                Ok(Box::pin(f))
            }
        }
    }

    /// Open a streaming writer. Truncates / creates as needed; the
    /// caller is expected to have ensured the parent dir exists (the
    /// `copy_file` helper above does that for you).
    pub async fn open_write(
        &self,
        path: &str,
    ) -> Result<Pin<Box<dyn AsyncWrite + Send>>, String> {
        match self {
            Backend::Local => {
                let f = tokio::fs::File::create(path)
                    .await
                    .map_err(|e| format!("create({path}): {e}"))?;
                Ok(Box::pin(f))
            }
            Backend::Sftp(client) => {
                let f = client.open_write(path).await?;
                Ok(Box::pin(f))
            }
        }
    }
}

/// POSIX-style parent. SFTP paths are always /-separated so we don't
/// need PathBuf gymnastics.
/// Async chunked read+write+sleep loop, matching `engine::copy_throttled`
/// but for the streaming `AsyncRead`/`AsyncWrite` path used by cross-
/// protocol jobs. Pacing tracks "expected elapsed at this byte count"
/// so jitter in upstream IO doesn't drift the running average.
async fn copy_throttled_async(
    reader: &mut Pin<Box<dyn AsyncRead + Send>>,
    writer: &mut Pin<Box<dyn AsyncWrite + Send>>,
    bandwidth_kbps: u64,
    src_path: &str,
    dest_path: &str,
) -> Result<u64, String> {
    use std::time::{Duration, Instant};
    use tokio::io::AsyncReadExt;

    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    let bytes_per_sec = bandwidth_kbps.saturating_mul(1024);
    let start = Instant::now();
    loop {
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| format!("read({src_path}): {e}"))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("write({dest_path}): {e}"))?;
        total += n as u64;
        let expected_ms = (total.saturating_mul(1000)) / bytes_per_sec.max(1);
        let actual_ms = start.elapsed().as_millis() as u64;
        if expected_ms > actual_ms {
            tokio::time::sleep(Duration::from_millis(expected_ms - actual_ms)).await;
        }
    }
    Ok(total)
}

fn parent_posix(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    let i = trimmed.rfind('/')?;
    Some(trimmed[..i].to_string())
}

/// Helper for the planner: walk a backend recursively, building a flat
/// list of `(absolute_path, size, mtime)` tuples. Local uses std::fs;
/// SFTP uses russh-sftp's read_dir + recursion.
pub async fn walk_files(
    backend: &Backend,
    root: &str,
) -> Result<Vec<(String, u64, Option<i64>)>, String> {
    match backend {
        Backend::Local => walk_local(Path::new(root)),
        Backend::Sftp(client) => walk_sftp(client, root).await,
    }
}

fn walk_local(root: &Path) -> Result<Vec<(String, u64, Option<i64>)>, String> {
    let md = std::fs::symlink_metadata(root)
        .map_err(|e| format!("stat({}): {e}", root.display()))?;
    if md.is_file() {
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        return Ok(vec![(
            root.to_string_lossy().into_owned(),
            md.len(),
            mtime,
        )]);
    }
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for d in read.flatten() {
            let p = d.path();
            let m = match std::fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if m.file_type().is_symlink() {
                continue;
            }
            if m.is_dir() {
                stack.push(p);
            } else {
                let mtime = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64);
                out.push((p.to_string_lossy().into_owned(), m.len(), mtime));
            }
        }
    }
    Ok(out)
}

async fn walk_sftp(
    client: &Arc<SftpClient>,
    root: &str,
) -> Result<Vec<(String, u64, Option<i64>)>, String> {
    // SftpClient already exposes a `dir_summary` recursive walker we
    // can adapt — but it returns counts only. Easier to add a dedicated
    // walker via a new public method on SftpClient. For Phase 0.2.0 we
    // re-use list_dir + manual recursion instead, since adding a new
    // public method to SftpClient ripples across more files.
    let mut out = Vec::new();
    let mut stack: Vec<String> = vec![root.to_string()];
    use crate::fs::types::ListOptions;
    while let Some(dir) = stack.pop() {
        let entries = client
            .list_dir(
                &dir,
                ListOptions {
                    show_hidden: true,
                },
            )
            .await
            .unwrap_or_default();
        for e in entries {
            if e.is_symlink {
                continue;
            }
            if e.is_dir {
                stack.push(e.path);
            } else {
                out.push((e.path, e.size, e.mtime));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uniq() -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::SystemTime;
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{t}-{n}")
    }

    #[tokio::test]
    async fn local_metadata_returns_none_for_missing() {
        let out = Backend::Local
            .metadata("/definitely/not/here/skiff-backend")
            .await
            .unwrap();
        assert!(out.is_none());
    }

    #[tokio::test]
    async fn local_read_then_write_round_trips() {
        let tmp = std::env::temp_dir().join(format!("skiff-backend-{}", uniq()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("a.txt");
        std::fs::write(&src, b"hello").unwrap();
        let bytes = Backend::Local
            .read_full(src.to_str().unwrap(), 1024)
            .await
            .unwrap();
        assert_eq!(bytes, b"hello");
        let dest = tmp.join("b.txt");
        Backend::Local
            .write_full(dest.to_str().unwrap(), &bytes)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        let _ = std::fs::remove_dir_all(tmp);
    }

    #[tokio::test]
    async fn local_read_full_refuses_oversize() {
        let tmp = std::env::temp_dir().join(format!("skiff-backend-{}", uniq()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("big.bin");
        std::fs::write(&src, vec![0u8; 4096]).unwrap();
        let result = Backend::Local
            .read_full(src.to_str().unwrap(), 100)
            .await;
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(tmp);
    }

    #[tokio::test]
    async fn local_walk_returns_recursive_files() {
        let root = std::env::temp_dir().join(format!("skiff-walk-{}", uniq()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.txt"), b"x").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.txt"), b"yy").unwrap();
        let out = walk_files(&Backend::Local, root.to_str().unwrap()).await.unwrap();
        assert_eq!(out.len(), 2);
        let total: u64 = out.iter().map(|(_, s, _)| *s).sum();
        assert_eq!(total, 3);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn parent_posix_handles_typical_paths() {
        assert_eq!(parent_posix("/foo/bar"), Some("/foo".into()));
        assert_eq!(parent_posix("/foo/bar/"), Some("/foo".into()));
        assert_eq!(parent_posix("foo"), None);
        assert_eq!(parent_posix("/foo"), Some("".into()));
    }
}
