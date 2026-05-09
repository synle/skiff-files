// Lazy-loaded image thumbnail for the Gallery / Tile views. Uses
// fs_read_base64 (subject to the 16 MB cap on the Rust side, which is
// fine — anything larger is a RAW we don't want to inline anyway) and
// caches the resulting data URL module-globally so scroll-back doesn't
// re-trigger a Tauri round-trip.
//
// Falls back to the kind icon when:
//   - The file exceeds the read cap (Rust returns an error)
//   - The path is remote (sftp://) — we'd need a separate read path
//   - The webview can't render the format (the <img> onError fires)
//
// Cache size is capped at MAX_CACHE entries with simple LRU eviction so
// browsing a 50k-image folder doesn't OOM the renderer.

import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { fsReadBase64, type FileKind } from "../api/fs";
import IconForKind from "./IconForKind";

/** Hard cap on cached thumbnails. ~200 entries at ~500 KB each is
 *  ~100 MB worst case, which is fine for a desktop renderer. */
const MAX_CACHE = 200;

/** Module-global LRU cache: path → data URL. We use insertion-order
 *  via Map.delete + Map.set on hit so the oldest entries fall off
 *  first when we hit the cap. */
const cache = new Map<string, string>();

function getCached(path: string): string | undefined {
  const hit = cache.get(path);
  if (hit !== undefined) {
    // Re-insert to mark as most-recently-used.
    cache.delete(path);
    cache.set(path, hit);
  }
  return hit;
}

function putCached(path: string, dataUrl: string): void {
  cache.set(path, dataUrl);
  while (cache.size > MAX_CACHE) {
    // Map iteration is insertion order — delete the oldest.
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Path-suffix → MIME for the data URL. We already know the entry is
 *  an image (the parent gates on `kind === "image"`) so we don't need
 *  to handle non-image extensions. */
function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    return "image/heic";
  }
  // Most common case: jpg / jpeg / .jfif fall through to image/jpeg.
  return "image/jpeg";
}

interface Props {
  path: string;
  /** Mirror of `Entry.kind` — used to decide whether to attempt an
   *  inline image load at all. Non-image kinds short-circuit to the
   *  fallback icon. */
  kind: FileKind;
  /** Pixel size of the rendered thumbnail. Same value used for icon
   *  fallback so the layout doesn't shift between states. */
  size: number;
  /** Skip the network round-trip — used by the parent when the path
   *  is remote (sftp://) since the local fs_read_base64 can't reach
   *  it. */
  remote?: boolean;
}

export default function GalleryThumb({
  path,
  kind,
  size,
  remote = false,
}: Props) {
  const isImage = kind === "image";
  const skipFetch = !isImage || remote;

  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    skipFetch ? null : getCached(path) ?? null,
  );
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (skipFetch) return;
    // Fast path: cache hit.
    const hit = getCached(path);
    if (hit !== undefined) {
      setDataUrl(hit);
      return;
    }
    let cancelled = false;
    setErrored(false);
    void fsReadBase64(path)
      .then((b64) => {
        if (cancelled) return;
        const url = `data:${mimeFor(path)};base64,${b64}`;
        putCached(path, url);
        setDataUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        // Common: file > 16 MB cap. Fall back to the kind icon.
        setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, skipFetch]);

  // Fallback path: render the kind icon (folder / image-without-thumb /
  // remote / errored). Same dimensions as the loaded thumbnail so
  // the layout doesn't shift when a load resolves.
  if (skipFetch || errored || !dataUrl) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          flexShrink: 0,
          "& svg": { fontSize: size - 4 },
        }}
      >
        <IconForKind kind={kind} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.hover",
        borderRadius: 0.5,
        overflow: "hidden",
      }}
    >
      <img
        src={dataUrl}
        alt=""
        loading="lazy"
        decoding="async"
        // object-fit: contain preserves aspect; the cell's bgcolor
        // hint shows for non-square images so the thumbnail reads
        // as a thumbnail, not a stretched rectangle.
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
        }}
        onError={() => setErrored(true)}
      />
    </Box>
  );
}
