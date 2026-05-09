// Thin wrapper around the `tauri-plugin-drag` plugin so the rest of
// the app doesn't have to know about the plugin protocol or the
// Channel API. Initiating an OS-native drag from a webview row is
// platform-specific (NSDraggingSource / IDataObject / GTK
// drag-and-drop); the Rust plugin handles all three. We invoke its
// `start_drag` command via the standard `plugin:<name>|<cmd>` URL.
//
// Caller responsibility: this only fires the OS drag — they're still
// responsible for any prior `dragstart`-event setup (e.g. transparent
// HTML5 drag image to suppress the in-window drag preview).
import { Channel, invoke } from "@tauri-apps/api/core";

interface DragOptions {
  /** "move" / "copy" / "link". Default "copy". */
  mode?: "move" | "copy" | "link";
}

/** Drag callback payload. The plugin reports drop / cancel + cursor
 *  position when the drag completes. We don't currently surface this
 *  to consumers — they typically just fire-and-forget — but the
 *  Channel must be wired or the command never resolves. */
interface DragCallback {
  result: "Dropped" | "Cancel";
  cursorPos: { x: number; y: number };
}

/** Initiate a native OS drag with the given file paths. Resolves
 *  once the drag begins (NOT when it ends — Tauri returns from the
 *  underlying NSDragSession / DoDragDrop call early). The callback
 *  channel fires when the user drops the items.
 *
 *  No-op / silent failure when the plugin isn't available (test
 *  environments, browser dev mode). */
export async function startNativeDrag(
  files: string[],
  options: DragOptions = {},
): Promise<void> {
  if (files.length === 0) return;
  const channel = new Channel<DragCallback>();
  // 1×1 transparent PNG as a data URL (the plugin's Base64Image
  // deserializer requires the `data:image/png;base64,` prefix). The
  // OS picks an appropriate drag preview from the dragged file paths
  // anyway; this is just a placeholder the plugin needs.
  const transparent1x1Png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  try {
    await invoke<void>("plugin:drag|start_drag", {
      // DragItem is `#[serde(untagged)]` — a bare array of strings
      // matches the Files variant (vs. an object for Data).
      item: files,
      image: transparent1x1Png,
      options: { mode: options.mode ?? "copy" },
      onEvent: channel,
    });
  } catch {
    /* plugin not registered (tests / browser-mode) — silent fallback */
  }
}
