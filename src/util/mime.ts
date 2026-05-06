// Lightweight extension → mime lookup. We only care about the kinds the
// preview pane renders inline; everything else is reported as
// `application/octet-stream` and the pane shows the properties block only.

const MIME: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  // pdf
  pdf: "application/pdf",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

/** Returns the mime type for a path's extension, or null if unknown. */
export function mimeForPath(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return MIME[ext] ?? null;
}

/** True if the path looks like an inline-renderable image. */
export function isImage(path: string): boolean {
  const m = mimeForPath(path);
  return !!m && m.startsWith("image/");
}
