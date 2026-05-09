// Canonical keyboard shortcut catalog. Both the cheatsheet modal (`?`)
// and the Settings → Keyboard read-only listing source from this so the
// two stay in sync. Each entry stays close to where the binding is
// actually wired (Browser keydown handler, BrowserTabs, etc.) — this
// file is documentation, not a router.

export interface Shortcut {
  /** Plain-language label rendered on the left. */
  keys: string;
  /** What the shortcut does. */
  description: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** The canonical list of bindings. Order matches frequency-of-use. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    items: [
      { keys: "↑ / ↓", description: "Move focus up / down (in grid views: previous / next row of cells)" },
      { keys: "Shift + ↑ / ↓ / ← / →", description: "Extend selection toward the new focused row" },
      { keys: "Enter", description: "Open the focused folder" },
      { keys: "Space", description: "Toggle the focused row's selection" },
      { keys: "Backspace · Cmd / Ctrl + ↑", description: "Go up one folder" },
      { keys: "Cmd / Ctrl + [ · Cmd / Ctrl + ←", description: "Back" },
      { keys: "Cmd / Ctrl + ] · Cmd / Ctrl + →", description: "Forward" },
      { keys: "Cmd / Ctrl + ↓", description: "Open focused entry (folder enters; file opens)" },
      { keys: "Mouse back / forward (X1 / X2)", description: "Folder history back / forward" },
      { keys: "Home / End", description: "Jump to first / last entry" },
      { keys: "Type letters", description: "Jump to next entry matching the typed prefix" },
      { keys: "Page Up / Page Down", description: "Jump roughly one viewport" },
    ],
  },
  {
    title: "Selection",
    items: [
      { keys: "Click", description: "Select one entry (replaces selection)" },
      { keys: "Cmd / Ctrl + Click", description: "Toggle entry in selection" },
      { keys: "Shift + Click", description: "Range select from focused row" },
      { keys: "Cmd / Ctrl + A", description: "Select all" },
      { keys: "Cmd / Ctrl + C", description: "Copy files (paste with Cmd+V) — also writes paths to text clipboard" },
      { keys: "Cmd / Ctrl + X", description: "Cut files (paste with Cmd+V to move)" },
      { keys: "Cmd / Ctrl + V", description: "Paste files into current folder" },
      { keys: "Delete", description: "Move selection to OS Trash" },
      { keys: "Cmd / Ctrl + Z", description: "Undo last trash (Linux / Windows; macOS uses Finder's own Cmd+Z)" },
      { keys: "Cmd / Ctrl + Shift + Backspace", description: "Permanently delete selection (skip Trash, no undo)" },
      { keys: "Esc", description: "Clear selection" },
    ],
  },
  {
    title: "Search",
    items: [
      { keys: "Cmd / Ctrl + F", description: "Filter visible entries" },
      { keys: "Cmd / Ctrl + Shift + F", description: "Recursive find" },
      { keys: "Esc (in search)", description: "Clear search" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: "Cmd / Ctrl + \\ · Cmd / Ctrl + B", description: "Toggle sidebar" },
      { keys: "Cmd / Ctrl + I", description: "Toggle preview pane" },
      { keys: "Cmd / Ctrl + R · F5", description: "Refresh current folder" },
      { keys: "Cmd / Ctrl + L", description: "Edit path (focus path bar)" },
      { keys: "Cmd / Ctrl + K", description: "Quick-jump (bookmarks + recent)" },
      { keys: "Cmd / Ctrl + Shift + P", description: "Command palette (every action, searchable)" },
      { keys: "Cmd / Ctrl + ,", description: "Open Settings" },
      { keys: "Cmd / Ctrl + Shift + N", description: "New folder" },
      { keys: "Cmd / Ctrl + D", description: "Bookmark current folder" },
      { keys: "F2", description: "Rename selected entry" },
      { keys: "Cmd / Ctrl + = / -", description: "Font size up / down (S / M / L cycle)" },
      { keys: "Cmd / Ctrl + 0", description: "Reset font size to medium" },
      { keys: "Cmd / Ctrl + Shift + .", description: "Toggle hidden files (dotfiles)" },
    ],
  },
  {
    title: "Tabs",
    items: [
      { keys: "Cmd / Ctrl + T", description: "New tab" },
      { keys: "Cmd / Ctrl + W", description: "Close active tab" },
      { keys: "Cmd / Ctrl + Shift + T", description: "Restore last closed tab" },
      { keys: "Cmd / Ctrl + N", description: "Open new window" },
      { keys: "Cmd / Ctrl + 1…9", description: "Switch to nth tab" },
      { keys: "Cmd / Ctrl + Shift + [ / ]", description: "Switch to previous / next tab" },
      { keys: "Cmd / Ctrl + Shift + ← / →", description: "Move active tab left / right" },
      { keys: "Middle-click folder", description: "Open folder in new tab" },
      { keys: "Cmd / Ctrl + Shift + \\", description: "Toggle two-pane (split) mode" },
    ],
  },
  {
    title: "Help",
    items: [
      { keys: "? · F1", description: "Show this cheatsheet" },
      { keys: "Esc", description: "Close this cheatsheet" },
    ],
  },
];
