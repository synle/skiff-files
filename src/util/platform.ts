// Platform detection helpers. The frontend has no Tauri OS plugin
// installed, but the WKWebView / WebView2 / WebKitGTK user-agent
// strings reliably carry the host platform marker, so a single
// `navigator.userAgent` check is enough for the surfaces that need
// to branch by OS (e.g. only render the macOS Full Disk Access
// section on macOS — that permission gate doesn't exist on Windows
// or Linux).
//
// Kept in `src/util/` rather than inlining at call sites so a test
// that needs to flip the verdict can stub `navigator.userAgent`
// once and every consumer sees the same answer.

/** True when the running webview is hosted on macOS. Returns `false`
 *  off-Tauri (jsdom in tests sets a generic UA), in which case
 *  callers can mock `navigator.userAgent` to flip the verdict. */
export function isMacOs(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  // macOS WKWebView carries "Macintosh" in the UA. iPad/iPhone
  // include "iPhone" / "iPad" so we don't accidentally treat iOS
  // (which would never run a Tauri desktop binary anyway) as macOS.
  return /Macintosh/.test(ua) && !/iPhone|iPad/.test(ua);
}
