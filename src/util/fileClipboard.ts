// In-memory file clipboard for cut/copy/paste workflows. Holds the
// last set of paths the user marked via Cmd+C / Cmd+X plus the
// operation (`"copy"` keeps the source; `"cut"` deletes the source
// after a successful paste). Browser tabs read this on Cmd+V to
// kick a Skiffsync from each path into the current folder.
//
// Module-level singleton: shared across tabs / panes / Browser
// instances without prop-drilling. Notifies via a window event so
// any consumer can render a "1 item ready to paste" hint.

export type FileClipboardOperation = "copy" | "cut";

export interface FileClipboardEntry {
  paths: string[];
  operation: FileClipboardOperation;
}

let current: FileClipboardEntry | null = null;

/** Custom DOM event fired when the clipboard changes. */
export const FILE_CLIPBOARD_EVENT = "skiff:file-clipboard";

export function setFileClipboard(
  paths: string[],
  operation: FileClipboardOperation,
): void {
  current = paths.length > 0 ? { paths: [...paths], operation } : null;
  window.dispatchEvent(new CustomEvent(FILE_CLIPBOARD_EVENT));
}

export function getFileClipboard(): FileClipboardEntry | null {
  return current;
}

export function clearFileClipboard(): void {
  current = null;
  window.dispatchEvent(new CustomEvent(FILE_CLIPBOARD_EVENT));
}
