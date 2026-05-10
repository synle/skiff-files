//! SQLite-backed thumbnail cache.
//!
//! On lookup we fingerprint the source file by `(path, mtime, size,
//! requested_size)` and check the cache. On miss, we decode + resize +
//! encode as PNG and store the bytes back. The result is returned as
//! base64 to the frontend so it can `data:image/png;base64,<...>` it
//! straight into an `<img>` tag.
//!
//! Why SQLite over per-file PNGs in a folder: lookups stay O(log n)
//! at any cache size, atomic writes are free (transactions), and
//! cleaning up "everything" is one `DELETE FROM thumbnails;` instead
//! of a recursive rmdir.
//!
//! Why fingerprint by `(mtime, size)` not file content hash: hashing
//! a 50 MB image to compute a cache key would defeat the purpose. The
//! mtime+size combination catches every realistic edit (same mtime +
//! same size = bit-identical for our purposes; if someone seeks past
//! that, the worst case is one stale thumbnail until the next change).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

/// Wrapper around the connection so we can hand it out as Tauri
/// State. The mutex serializes writes — readers are fine concurrent
/// in SQLite but we only have one process so the mutex covers all
/// access points uniformly.
pub struct ThumbnailCache {
    conn: Mutex<Connection>,
}

impl ThumbnailCache {
    /// Open (or create) the cache database at the given path. Creates
    /// parent directories + applies the schema on first run.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir({}): {e}", parent.display()))?;
        }
        let conn = Connection::open(db_path)
            .map_err(|e| format!("sqlite open({}): {e}", db_path.display()))?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS thumbnails (
                key            TEXT    PRIMARY KEY,
                path           TEXT    NOT NULL,
                src_mtime_ms   INTEGER NOT NULL,
                src_size_bytes INTEGER NOT NULL,
                thumb_size_px  INTEGER NOT NULL,
                created_ms     INTEGER NOT NULL,
                png_bytes      BLOB    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_thumbnails_path ON thumbnails(path);
            ",
        )
        .map_err(|e| format!("sqlite schema: {e}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Compose the cache key from the source-file fingerprint + the
    /// requested thumbnail size. Different sizes get separate cache
    /// rows so the Tile / Gallery / Sidebar consumers can request
    /// independently.
    fn cache_key(path: &str, mtime_ms: i64, size_bytes: i64, thumb_px: u32) -> String {
        format!("{path}|{mtime_ms}|{size_bytes}|{thumb_px}")
    }

    /// Look up a cached PNG. Returns the bytes verbatim.
    pub fn get(
        &self,
        path: &str,
        mtime_ms: i64,
        size_bytes: i64,
        thumb_px: u32,
    ) -> Result<Option<Vec<u8>>, String> {
        let key = Self::cache_key(path, mtime_ms, size_bytes, thumb_px);
        let conn = self.conn.lock().map_err(|_| "cache mutex poisoned".to_string())?;
        let bytes: Option<Vec<u8>> = conn
            .query_row(
                "SELECT png_bytes FROM thumbnails WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .ok();
        Ok(bytes)
    }

    /// Insert (or replace) a PNG payload.
    pub fn put(
        &self,
        path: &str,
        mtime_ms: i64,
        size_bytes: i64,
        thumb_px: u32,
        png: &[u8],
    ) -> Result<(), String> {
        let key = Self::cache_key(path, mtime_ms, size_bytes, thumb_px);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().map_err(|_| "cache mutex poisoned".to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO thumbnails
                 (key, path, src_mtime_ms, src_size_bytes, thumb_size_px, created_ms, png_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![key, path, mtime_ms, size_bytes, thumb_px as i64, now_ms, png],
        )
        .map_err(|e| format!("sqlite insert: {e}"))?;
        Ok(())
    }

    /// Drop everything. Used by the Settings → Advanced "Clear
    /// thumbnail cache" button.
    pub fn clear(&self) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|_| "cache mutex poisoned".to_string())?;
        let n = conn
            .execute("DELETE FROM thumbnails", [])
            .map_err(|e| format!("sqlite clear: {e}"))?;
        // VACUUM reclaims disk; otherwise the .db keeps its high-water
        // mark size after a clear.
        conn.execute("VACUUM", [])
            .map_err(|e| format!("sqlite vacuum: {e}"))?;
        Ok(n as u64)
    }

    /// Row count + on-disk size in bytes. The Settings UI shows both.
    pub fn stats(&self) -> Result<CacheStats, String> {
        let conn = self.conn.lock().map_err(|_| "cache mutex poisoned".to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM thumbnails", [], |row| row.get(0))
            .map_err(|e| format!("sqlite count: {e}"))?;
        let bytes: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(png_bytes)), 0) FROM thumbnails",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("sqlite size: {e}"))?;
        Ok(CacheStats {
            count: count as u64,
            bytes: bytes as u64,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub count: u64,
    pub bytes: u64,
}

/// Decode `path`, resize so the longest side is `target_px`, encode
/// as PNG. Pure helper — doesn't touch the cache. Used by the
/// `fs_thumbnail` command after a cache miss.
pub fn render_thumbnail(path: &str, target_px: u32) -> Result<Vec<u8>, String> {
    let img = image::open(path).map_err(|e| format!("decode({path}): {e}"))?;
    // `thumbnail` preserves aspect ratio + uses a fast nearest-neighbor
    // path; for thumbnails that's the right tradeoff (decode is the
    // bottleneck, not the resize). Lanczos filter would be sharper
    // but ~5x slower, and at 128 px nobody can tell.
    let resized = img.thumbnail(target_px, target_px);
    let mut out: Vec<u8> = Vec::new();
    resized
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| format!("encode png: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uniq(prefix: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("skiff-{prefix}-{nanos}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn cache_round_trip_and_stats() {
        let dir = uniq("thumb-cache");
        let cache = ThumbnailCache::open(&dir.join("t.db")).unwrap();

        // Empty.
        let s = cache.stats().unwrap();
        assert_eq!(s.count, 0);
        assert_eq!(s.bytes, 0);

        // Insert.
        let payload = b"\x89PNG\r\n\x1a\n_fake_png_bytes_".to_vec();
        cache.put("/a/b.jpg", 1_700_000_000, 4096, 128, &payload).unwrap();

        // Hit.
        let got = cache.get("/a/b.jpg", 1_700_000_000, 4096, 128).unwrap();
        assert_eq!(got.as_deref(), Some(payload.as_slice()));

        // Miss on different mtime / size / thumb size.
        assert!(cache.get("/a/b.jpg", 1_700_000_001, 4096, 128).unwrap().is_none());
        assert!(cache.get("/a/b.jpg", 1_700_000_000, 4097, 128).unwrap().is_none());
        assert!(cache.get("/a/b.jpg", 1_700_000_000, 4096, 256).unwrap().is_none());

        // Stats reflect the insert.
        let s = cache.stats().unwrap();
        assert_eq!(s.count, 1);
        assert!(s.bytes > 0);

        // Clear.
        let n = cache.clear().unwrap();
        assert_eq!(n, 1);
        let s = cache.stats().unwrap();
        assert_eq!(s.count, 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn render_a_real_png_thumbnail() {
        let dir = uniq("thumb-render");
        let p = dir.join("big.png");
        // 256x192 red rectangle — big enough that a 64-px thumbnail
        // is meaningfully smaller.
        let mut buf = image::RgbImage::new(256, 192);
        for px in buf.pixels_mut() {
            *px = image::Rgb([10, 200, 50]);
        }
        buf.save_with_format(&p, image::ImageFormat::Png).unwrap();

        let bytes = render_thumbnail(p.to_str().unwrap(), 64).unwrap();
        // Decode the PNG we just produced and confirm dimensions
        // shrank while preserving aspect ratio.
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert!(decoded.width() <= 64);
        assert!(decoded.height() <= 64);
        // Aspect ratio preserved: original 256/192 = 4/3, so a
        // 64-wide thumbnail should be 48 tall.
        assert_eq!(decoded.width(), 64);
        assert_eq!(decoded.height(), 48);

        std::fs::remove_dir_all(&dir).ok();
    }
}
