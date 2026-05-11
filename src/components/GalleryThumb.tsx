// Lazy-loaded image thumbnail for the Gallery / Tile views.
//
// As of 0.2.245 we go through `fs_thumbnail`, which returns a
// resized PNG straight from the SQLite-backed thumbnail cache. The
// Rust side does the decode + resize + encode; the cache key
// includes (mtime, size, sizePx) so an edit invalidates
// automatically and the same file at different thumbnail sizes
// (Tile vs Gallery) coexists without thrashing. We still keep an
// in-memory LRU on top to dodge the IPC round-trip on scroll-back.
//
// Falls back to the kind icon when:
//   - Rust can't decode the file (corrupt / unsupported format)
//   - The path is remote (sftp://) — the thumbnail command is
//     local-only at this stage
//   - The webview can't render the format (the <img> onError fires)
//
// Cache size is capped at MAX_CACHE entries with simple LRU eviction
// so browsing a 50k-image folder doesn't OOM the renderer.

import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { fsThumbnail, type FileKind } from "../api/fs";
import IconForKind from "./IconForKind";

/** Hard cap on cached thumbnails. ~200 entries at ~500 KB each is
 *  ~100 MB worst case, which is fine for a desktop renderer. */
const MAX_CACHE = 200;

/** Module-global LRU cache: path → data URL. We use insertion-order
 *  via Map.delete + Map.set on hit so the oldest entries fall off
 *  first when we hit the cap. */
const cache = new Map<string, string>();

/** Key includes size so Tile + Gallery views of the same file don't
 *  collide on a single cache row at differing thumbnail dimensions. */
function cacheKey(path: string, size: number): string {
  return `${size}|${path}`;
}

function getCached(path: string, size: number): string | undefined {
  const key = cacheKey(path, size);
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Re-insert to mark as most-recently-used.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function putCached(path: string, size: number, dataUrl: string): void {
  cache.set(cacheKey(path, size), dataUrl);
  while (cache.size > MAX_CACHE) {
    // Map iteration is insertion order — delete the oldest.
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// `fs_thumbnail` always returns PNG bytes, so the data-URL MIME is
// fixed regardless of the source file's extension.
const THUMB_MIME = "image/png";

interface Props {
  path: string;
  /** Mirror of `Entry.kind` — used to decide whether to attempt an
   *  inline image load at all. Non-image kinds short-circuit to the
   *  fallback icon. */
  kind: FileKind;
  /** Pixel size of the rendered thumbnail. Same value used for icon
   *  fallback so the layout doesn't shift between states. Also the
   *  resolution we ask the Rust cache to decode at — the rendered
   *  box may stretch larger via CSS (`fill`) but the underlying
   *  pixels are sized to `size` so the cache stays compact. */
  size: number;
  /** Skip the network round-trip — used by the parent when the path
   *  is remote (sftp://) since the local fs_read_base64 can't reach
   *  it. */
  remote?: boolean;
  /** When true, the rendered box stretches to fill its parent
   *  (`width: 100%, height: 100%`) and the image uses
   *  `object-fit: cover` so it edge-to-edges the cell rather than
   *  letterboxing. The fallback kind-icon stays centered. Default
   *  false → fixed `size × size` box (original behavior). */
  fill?: boolean;
}

export default function GalleryThumb({
  path,
  kind,
  size,
  remote = false,
  fill = false,
}: Props) {
  const isImage = kind === "image";
  const skipFetch = !isImage || remote;

  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    skipFetch ? null : getCached(path, size) ?? null,
  );
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (skipFetch) return;
    // Fast path: cache hit.
    const hit = getCached(path, size);
    if (hit !== undefined) {
      setDataUrl(hit);
      return;
    }
    let cancelled = false;
    setErrored(false);
    void fsThumbnail(path, size)
      .then((b64) => {
        if (cancelled) return;
        const url = `data:${THUMB_MIME};base64,${b64}`;
        putCached(path, size, url);
        setDataUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        // Common: unsupported format / decode error. Fall back to
        // the kind icon — same UX as the pre-cache code path.
        setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, size, skipFetch]);

  // Fallback path: render the kind icon (folder / image-without-thumb /
  // remote / errored). When `fill` is true the box stretches to its
  // parent and the icon stays centered at `size`; otherwise it's the
  // legacy fixed `size × size` box so the layout doesn't shift when
  // a load resolves.
  if (skipFetch || errored || !dataUrl) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: fill ? "100%" : size,
          height: fill ? "100%" : size,
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
        width: fill ? "100%" : size,
        height: fill ? "100%" : size,
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
        // fill=true → `cover` edges the image to the box so the cell
        // reads as a proper thumbnail without empty padding. fill=false
        // → `contain` preserves aspect inside a fixed box (the legacy
        // shape used by surfaces that mix thumbs with icons of the
        // same size, like the preview pane).
        style={{
          width: fill ? "100%" : undefined,
          height: fill ? "100%" : undefined,
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: fill ? "cover" : "contain",
        }}
        onError={() => setErrored(true)}
      />
    </Box>
  );
}
