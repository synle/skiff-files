// Typed wrappers for the macOS Full Disk Access (TCC) probe + System
// Settings deep-link. Both commands are no-op / always-true /
// always-error on non-macOS targets (see `src-tauri/src/permissions.rs`),
// so the frontend can call them unconditionally without a platform
// branch — the App-level handler simply doesn't fire the prompt when
// the probe returns `true`.

import { invoke } from "@tauri-apps/api/core";

/** Probe whether the running process has macOS Full Disk Access. On
 *  Windows / Linux this resolves to `true` (no equivalent privacy
 *  gate). On macOS, returns `false` only when at least one canonical
 *  TCC-protected probe path explicitly rejected with permission
 *  denied — inconclusive errors (path missing, etc.) resolve to
 *  `true` so brand-new macOS installs that never opened Safari /
 *  Mail / Messages don't see a false-positive prompt. */
export const macosCheckFullDiskAccess = (): Promise<boolean> =>
  invoke<boolean>("macos_check_full_disk_access");

/** Open System Settings → Privacy & Security → Full Disk Access via
 *  the documented `x-apple.systempreferences:` URL scheme. Rejects
 *  with an actionable error on non-macOS targets so the caller can
 *  surface it instead of silently no-op'ing. */
export const macosOpenFullDiskAccessSettings = (): Promise<void> =>
  invoke<void>("macos_open_full_disk_access_settings");
