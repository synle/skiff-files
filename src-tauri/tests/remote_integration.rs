//! Integration tests against the Docker-compose stack in
//! `docker/docker-compose.yml`. Verifies that each remote backend
//! (SFTP, FTP, SMB) round-trips a basic create / list / read /
//! rename / delete cycle, plus a handful of cross-mode transfers
//! that exercise the same primitives `Skiffsync` uses.
//!
//! Gated by `SKIFF_INTEGRATION=1` so the suite stays opt-in — a
//! plain `cargo test` from someone who doesn't have docker running
//! shouldn't fail. CI sets the variable in
//! `.github/workflows/integration.yml`.
//!
//! Run locally:
//!   docker compose -f docker/docker-compose.yml up -d
//!   SKIFF_INTEGRATION=1 cargo test --test remote_integration
//!   docker compose -f docker/docker-compose.yml down -v

use app_lib::fs::ftp::{FtpClient, FtpConfig};
use app_lib::fs::sftp::{SftpClient, SftpConfig};
use app_lib::fs::smb::{SmbConfig, SmbConnection};
use app_lib::fs::types::ListOptions;
use std::sync::Arc;
use std::time::Duration;

fn enabled() -> bool {
    std::env::var("SKIFF_INTEGRATION").as_deref() == Ok("1")
}

/// Bail-out helper — every test starts with `if !enabled() { return; }`.
/// A macro keeps the call sites short.
macro_rules! gate {
    () => {
        if !enabled() {
            eprintln!("skipping (SKIFF_INTEGRATION not set)");
            return;
        }
    };
}

const USER: &str = "testuser";
const PASS: &str = "skiffpass";

// ── Connection helpers ────────────────────────────────────────────────────

async fn connect_sftp() -> Arc<SftpClient> {
    let cfg = SftpConfig {
        host: "127.0.0.1".into(),
        port: 2222,
        user: USER.into(),
        password: Some(PASS.into()),
        private_key_path: None,
        private_key_passphrase: None,
        use_agent: false,
    };
    let mut last_err = None;
    // OpenSSH-server image takes ~2-3s to be ready after compose up;
    // retry a few times so a cold-start test run doesn't flake.
    for _ in 0..15 {
        match SftpClient::connect(cfg.clone(), None).await {
            Ok(c) => return Arc::new(c),
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    panic!("sftp connect failed: {:?}", last_err);
}

async fn connect_ftp() -> Arc<FtpClient> {
    let cfg = FtpConfig {
        host: "127.0.0.1".into(),
        port: 2121,
        user: USER.into(),
        password: PASS.into(),
    };
    let mut last_err = None;
    for _ in 0..15 {
        match FtpClient::connect(cfg.clone()).await {
            Ok(c) => return c,
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    panic!("ftp connect failed: {:?}", last_err);
}

async fn connect_smb() -> Arc<SmbConnection> {
    let cfg = SmbConfig {
        host: "127.0.0.1".into(),
        port: 1445,
        share: "testshare".into(),
        user: USER.into(),
        password: PASS.into(),
        domain: String::new(),
    };
    let mut last_err = None;
    for _ in 0..15 {
        match SmbConnection::connect(cfg.clone()).await {
            Ok(c) => return c,
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    panic!("smb connect failed: {:?}", last_err);
}

// ── Per-backend basic round-trip ──────────────────────────────────────────

/// Drive each protocol's CRUD verbs through a single helper so the
/// three per-mode tests are byte-identical in shape. The closure
/// receives a `name` and returns futures that perform the same
/// logical step (write a file, list, read, rename, delete).
///
/// The leading `/` on every path is the share-root for SMB and the
/// FTP-user home + SFTP-user home for those backends — all three
/// servers in the compose file map them to the same writable
/// directory, so cross-mode tests share a namespace.

// All tests run on a multi-threaded runtime so `block_in_place`
// inside the FTP / SFTP clients (suppaftp + russh-sftp use sync
// methods we wrap that way) works without panicking. The default
// `#[tokio::test]` is current_thread which doesn't allow it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sftp_basic_roundtrip() {
    gate!();
    let c = connect_sftp().await;
    let dir = "/config";
    let file = format!("{dir}/skiff_sftp_test.txt");
    // Write
    write_text(BackendRef::Sftp(&c), &file, b"hello sftp").await;
    // Exists in listing
    let entries = c
        .list_dir(dir, ListOptions { show_hidden: true })
        .await
        .unwrap();
    assert!(entries.iter().any(|e| e.name == "skiff_sftp_test.txt"));
    // Read back
    let text = c.read_text(&file, 1024).await.unwrap();
    assert_eq!(text, "hello sftp");
    // Rename
    let renamed = format!("{dir}/skiff_sftp_test_renamed.txt");
    c.rename(&file, &renamed).await.unwrap();
    // Delete
    c.remove(&renamed).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ftp_basic_roundtrip() {
    gate!();
    let c = connect_ftp().await;
    let dir = "/home/testuser";
    let file = format!("{dir}/skiff_ftp_test.txt");
    write_text(BackendRef::Ftp(&c), &file, b"hello ftp").await;
    let entries = c
        .list_dir(dir, ListOptions { show_hidden: true })
        .await
        .unwrap();
    assert!(entries.iter().any(|e| e.name == "skiff_ftp_test.txt"));
    let text = c.read_text(&file, 1024).await.unwrap();
    assert_eq!(text, "hello ftp");
    let renamed = format!("{dir}/skiff_ftp_test_renamed.txt");
    c.rename(&file, &renamed).await.unwrap();
    c.remove(&renamed).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn smb_basic_roundtrip() {
    gate!();
    let c = connect_smb().await;
    let dir = "/";
    let file = "/skiff_smb_test.txt".to_string();
    write_text(BackendRef::Smb(&c), &file, b"hello smb").await;
    let entries = c
        .list_dir(dir, ListOptions { show_hidden: true })
        .await
        .unwrap();
    assert!(entries.iter().any(|e| e.name == "skiff_smb_test.txt"));
    let text = c.read_text(&file, 1024).await.unwrap();
    assert_eq!(text, "hello smb");
    let renamed = "/skiff_smb_test_renamed.txt".to_string();
    c.rename(&file, &renamed).await.unwrap();
    c.remove(&renamed).await.unwrap();
}

// ── Cross-backend copy ────────────────────────────────────────────────────
//
// Same primitive Skiffsync uses: read from source, write to dest. The
// test isn't trying to exercise Skiffsync's resume / progress logic —
// it's verifying the three backends can interoperate at all so a future
// regression in any of them surfaces here, not in production.

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cross_mode_sftp_to_smb() {
    gate!();
    let src = connect_sftp().await;
    let dst = connect_smb().await;
    let src_path = "/config/skiff_xmode_src.txt";
    let dst_path = "/skiff_xmode_sftp_to_smb.txt";
    let payload = b"cross-mode sftp -> smb";
    write_text(BackendRef::Sftp(&src), src_path, payload).await;
    // Read from sftp via read_text (small payload), then write to smb.
    // For larger files we'd stream; the engine layer wraps this in
    // chunks but a single-shot copy is fine for the round-trip test.
    let body = src.read_text(src_path, 4096).await.unwrap();
    write_text(BackendRef::Smb(&dst), dst_path, body.as_bytes()).await;
    let dst_body = dst.read_text(dst_path, 4096).await.unwrap();
    assert_eq!(dst_body, "cross-mode sftp -> smb");
    src.remove(src_path).await.unwrap();
    dst.remove(dst_path).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cross_mode_ftp_to_smb() {
    gate!();
    let src = connect_ftp().await;
    let dst = connect_smb().await;
    let src_path = "/home/testuser/skiff_xmode_src.txt";
    let dst_path = "/skiff_xmode_ftp_to_smb.txt";
    let payload = b"cross-mode ftp -> smb";
    write_text(BackendRef::Ftp(&src), src_path, payload).await;
    let body = src.read_text(src_path, 4096).await.unwrap();
    write_text(BackendRef::Smb(&dst), dst_path, body.as_bytes()).await;
    let dst_body = dst.read_text(dst_path, 4096).await.unwrap();
    assert_eq!(dst_body, "cross-mode ftp -> smb");
    src.remove(src_path).await.unwrap();
    dst.remove(dst_path).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cross_mode_smb_to_sftp() {
    gate!();
    let src = connect_smb().await;
    let dst = connect_sftp().await;
    let src_path = "/skiff_xmode_src.txt";
    let dst_path = "/config/skiff_xmode_smb_to_sftp.txt";
    let payload = b"cross-mode smb -> sftp";
    write_text(BackendRef::Smb(&src), src_path, payload).await;
    let body = src.read_text(src_path, 4096).await.unwrap();
    write_text(BackendRef::Sftp(&dst), dst_path, body.as_bytes()).await;
    let dst_body = dst.read_text(dst_path, 4096).await.unwrap();
    assert_eq!(dst_body, "cross-mode smb -> sftp");
    src.remove(src_path).await.unwrap();
    dst.remove(dst_path).await.unwrap();
}

// ── Write helper ─────────────────────────────────────────────────────────
//
// Each backend exposes write differently (FTP/SFTP have streaming
// putters, SMB has `write_file`). For test purposes we hide the
// difference behind a small `BackendRef` enum so the per-protocol
// tests stay byte-identical.

enum BackendRef<'a> {
    Sftp(&'a Arc<SftpClient>),
    Ftp(&'a Arc<FtpClient>),
    Smb(&'a Arc<SmbConnection>),
}

async fn write_text(backend: BackendRef<'_>, path: &str, bytes: &[u8]) {
    match backend {
        BackendRef::Sftp(c) => {
            c.write_full(path, bytes)
                .await
                .unwrap_or_else(|e| panic!("sftp write {path}: {e}"));
        }
        BackendRef::Ftp(c) => {
            c.write_bytes(path, bytes)
                .await
                .unwrap_or_else(|e| panic!("ftp write {path}: {e}"));
        }
        BackendRef::Smb(c) => {
            c.write_bytes(path, bytes)
                .await
                .unwrap_or_else(|e| panic!("smb write {path}: {e}"));
        }
    }
}
