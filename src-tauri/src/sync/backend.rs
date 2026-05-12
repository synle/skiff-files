//! Backend abstraction for the cross-protocol sync engine. Each
//! variant exposes the same async surface so the cross-engine can copy
//! between any pair without the per-step branching that plagues the
//! local-only engine.
//!
//! Phase 0.2.0 ships Local + Sftp. FTP / SMB join here in 0.2.1 / 0.2.2
//! once those backends exist; the cross-engine never has to change to
//! pick them up — `Backend::Ftp(...)`, `Backend::Smb(...)` slot in.

use crate::fs::sftp::SftpClient;
use crate::fs::smb::SmbConnection;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::UNIX_EPOCH;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};

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

/// Backend handle. The `Sftp` / `Smb` variants carry the registry's
/// `Arc<...>` so the cross-engine doesn't have to thread the
/// connection registry through every call.
#[derive(Clone)]
pub enum Backend {
    Local,
    Sftp(Arc<SftpClient>),
    /// SMB / Samba sink (0.2.26x). Wires in via `resolve_backend`'s
    /// `smb://<uuid>/<path>` parser in `commands.rs`. The smb2 0.8
    /// crate doesn't expose async streaming primitives — reads pull
    /// the full file into memory, writes buffer until shutdown and
    /// then flush via `client.write_bytes`. Adequate for the typical
    /// file-explorer workload (<100 MB per file); larger files
    /// should migrate to `write_file_streamed` once that lands here.
    Smb(Arc<SmbConnection>),
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
            Backend::Smb(client) => match client.stat(path).await {
                Ok(entry) => Ok(Some(PathMeta {
                    size: entry.size,
                    mtime: entry.mtime,
                    is_dir: entry.is_dir,
                    is_symlink: entry.is_symlink,
                })),
                // Same flattened-error caveat as SFTP — `stat` against
                // a missing path returns Err("STATUS_OBJECT_NAME_NOT_
                // FOUND" or similar). Treat all errors as "no existing
                // dest" so the conflict checker just copies through.
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
            Backend::Smb(client) => {
                // Same base64 round-trip the SMB module exposes — the
                // alternative (calling smb2 client.read_file directly)
                // would need to crack open the mutex from outside the
                // SmbConnection abstraction.
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
            Backend::Smb(client) => {
                // Same parent-dir-first rule as SFTP — the SMB server
                // returns STATUS_OBJECT_PATH_NOT_FOUND on writes into a
                // missing intermediate directory.
                if let Some(parent) = parent_posix(path) {
                    if !parent.is_empty() {
                        client.mkdir(&parent).await?;
                    }
                }
                client.write_bytes(path, data).await
            }
        }
    }

    /// Recursively create a directory.
    pub async fn mkdir_p(&self, path: &str) -> Result<(), String> {
        match self {
            Backend::Local => std::fs::create_dir_all(path)
                .map_err(|e| format!("mkdir_p({path}): {e}")),
            Backend::Sftp(client) => client.mkdir(path).await,
            // `SmbConnection::mkdir` already walks parents internally —
            // it's idempotent against existing directories. Same
            // shape as the SFTP path so the cross-engine doesn't need
            // a special case.
            Backend::Smb(client) => client.mkdir(path).await,
        }
    }

    /// Rename / same-FS move within a single backend. Cross-backend
    /// rename is a copy + remove; the cross-engine handles that path.
    pub async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        match self {
            Backend::Local => std::fs::rename(from, to)
                .map_err(|e| format!("rename({from} -> {to}): {e}")),
            Backend::Sftp(client) => client.rename(from, to).await,
            Backend::Smb(client) => client.rename(from, to).await,
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
            Backend::Smb(client) => {
                // smb2 0.8 doesn't expose an async streaming reader —
                // the only file-read primitive is `read_file` which
                // returns the whole payload as `Vec<u8>`. Pull the
                // bytes eagerly and hand back a Cursor-shaped
                // `AsyncRead` so `tokio::io::copy` works unchanged.
                // OK for typical sizes; revisit when we copy multi-GB
                // files through SMB.
                let data = client.read_base64(path, u64::MAX).await?;
                use base64::engine::general_purpose::STANDARD as B64;
                use base64::Engine as _;
                let bytes = B64
                    .decode(data)
                    .map_err(|e| format!("decode base64({path}): {e}"))?;
                Ok(Box::pin(SmbReader { buf: bytes, pos: 0 }))
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
            Backend::Smb(client) => {
                // smb2 0.8 doesn't expose AsyncWrite either —
                // `write_file` takes the entire payload. Buffer
                // every `poll_write` into RAM, flush via
                // `write_bytes` on `poll_shutdown`. The cross-engine
                // already calls shutdown right after copy_file
                // finishes, so the flush lands deterministically.
                Ok(Box::pin(SmbWriter {
                    client: client.clone(),
                    path: path.to_string(),
                    buf: Vec::new(),
                    write_future: None,
                }))
            }
        }
    }
}

/// Vec-backed reader used by `Backend::Smb::open_read`. Lives here
/// (not in `fs/smb.rs`) so it stays scoped to the cross-engine — the
/// SmbConnection API itself is whole-file-bytes; the adapter is only
/// needed when feeding `tokio::io::copy`.
struct SmbReader {
    buf: Vec<u8>,
    pos: usize,
}

impl AsyncRead for SmbReader {
    fn poll_read(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        dst: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let me = self.get_mut();
        let remaining = me.buf.len() - me.pos;
        let n = std::cmp::min(dst.remaining(), remaining);
        if n == 0 {
            return Poll::Ready(Ok(()));
        }
        dst.put_slice(&me.buf[me.pos..me.pos + n]);
        me.pos += n;
        Poll::Ready(Ok(()))
    }
}

/// Buffered writer that accumulates every `poll_write` into a Vec
/// then flushes the whole payload via `SmbConnection::write_bytes`
/// on `poll_shutdown`. Tokio's `AsyncWriteExt::shutdown` is what the
/// cross-engine's `copy_file` calls after the read-loop completes,
/// so this is when the actual SMB write happens.
struct SmbWriter {
    client: Arc<SmbConnection>,
    path: String,
    buf: Vec<u8>,
    /// In-flight write_bytes call. Stored across poll_shutdown
    /// invocations so a Poll::Pending → re-poll keeps the same
    /// future alive (otherwise we'd start a new write on every
    /// re-poll and race ourselves).
    write_future:
        Option<Pin<Box<dyn Future<Output = Result<(), String>> + Send>>>,
}

impl AsyncWrite for SmbWriter {
    fn poll_write(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let me = self.get_mut();
        me.buf.extend_from_slice(data);
        Poll::Ready(Ok(data.len()))
    }

    fn poll_flush(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        // Flush is a no-op until shutdown — we hold the payload in
        // RAM and only send it once we know we're done writing.
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.write_future.is_none() {
            // DEBUG(paste-smb): flush kicks off here. Buffer size is
            // the total bytes that came in through poll_write — the
            // entire source file payload at this point.
            eprintln!(
                "[SmbWriter] shutdown -> write_bytes path={:?} bytes={}",
                self.path,
                self.buf.len()
            );
            let client = self.client.clone();
            let path = self.path.clone();
            let buf = std::mem::take(&mut self.buf);
            self.write_future = Some(Box::pin(async move {
                let r = client.write_bytes(&path, &buf).await;
                eprintln!(
                    "[SmbWriter] write_bytes result path={:?} ok={}",
                    path,
                    r.is_ok()
                );
                r
            }));
        }
        let fut = self.write_future.as_mut().expect("set above");
        match fut.as_mut().poll(cx) {
            Poll::Ready(Ok(())) => Poll::Ready(Ok(())),
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::other(e))),
            Poll::Pending => Poll::Pending,
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
        Backend::Smb(client) => walk_smb(client, root).await,
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
    //
    // Single-file short-circuit (same shape as `walk_local` /
    // `walk_smb`): without this, calling walk_sftp on a file path
    // returns an empty list (list_dir on a non-directory is empty),
    // the planner finds 0 files, and the copy silently no-ops —
    // which is what broke paste from a remote source.
    if let Ok(entry) = client.stat(root).await {
        if !entry.is_dir {
            return Ok(vec![(root.to_string(), entry.size, entry.mtime)]);
        }
    }
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

async fn walk_smb(
    client: &Arc<SmbConnection>,
    root: &str,
) -> Result<Vec<(String, u64, Option<i64>)>, String> {
    // DFS over list_dir, accumulating files. SmbConnection::list_dir
    // returns paths relative to the share root (the connection was
    // bound to a single share at connect time); the cross-engine
    // treats those as absolute since the backend identity already
    // encodes the share.
    //
    // Single-file short-circuit: paste iterates per-clipboard-entry,
    // so each call lands here with `root` pointing at one file.
    // Calling list_dir on a non-directory returns empty, the planner
    // sees zero files, and the copy silently no-ops. Mirror
    // `walk_local`'s pattern — stat the root first; if it's a file,
    // return a single-element list. Same fix lives in `walk_sftp` so
    // single-file paste works there too.
    eprintln!("[walk_smb] enter root={:?}", root);
    if let Ok(entry) = client.stat(root).await {
        if !entry.is_dir {
            eprintln!("[walk_smb] root is a file, returning single entry");
            return Ok(vec![(root.to_string(), entry.size, entry.mtime)]);
        }
    }
    let mut out = Vec::new();
    let mut stack: Vec<String> = vec![root.to_string()];
    use crate::fs::types::ListOptions;
    while let Some(dir) = stack.pop() {
        let listed = client
            .list_dir(
                &dir,
                ListOptions {
                    show_hidden: true,
                },
            )
            .await;
        let entries = match listed {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[walk_smb] list_dir({:?}) FAILED: {}", dir, e);
                Vec::new()
            }
        };
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
    eprintln!("[walk_smb] done root={:?} files={}", root, out.len());
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
