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
  /** Stable action id. Present only for shortcuts that have been
   *  migrated to the `Settings.shortcutOverrides` lookup — those
   *  are user-rebindable from Settings → Keyboard. The rest are
   *  documentation-only for now. */
  actionId?: string;
  /** Default combo string for rebindable shortcuts (used when no
   *  override is set). Lowercase + `+`-joined per `keybindings.ts`. */
  defaultCombo?: string;
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
      {
        keys: "Cmd / Ctrl + [ · Cmd / Ctrl + ←",
        description: "Back (Cmd+← always works as alias)",
        actionId: "browser.back",
        defaultCombo: "cmd+[",
      },
      {
        keys: "Cmd / Ctrl + ] · Cmd / Ctrl + →",
        description: "Forward (Cmd+→ always works as alias)",
        actionId: "browser.forward",
        defaultCombo: "cmd+]",
      },
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
      {
        keys: "Delete",
        description: "Move selection to OS Trash",
        actionId: "browser.trash",
        defaultCombo: "delete",
      },
      {
        keys: "Cmd / Ctrl + Z",
        description: "Undo last trash (Linux / Windows; macOS uses Finder's own Cmd+Z)",
        actionId: "browser.undoTrash",
        defaultCombo: "cmd+z",
      },
      {
        keys: "Cmd / Ctrl + Shift + Backspace",
        description: "Permanently delete selection (skip Trash, no undo)",
        actionId: "browser.permanentDelete",
        defaultCombo: "cmd+shift+backspace",
      },
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
      {
        keys: "Cmd / Ctrl + \\ · Cmd / Ctrl + B",
        description: "Toggle sidebar",
        actionId: "app.toggleSidebar",
        defaultCombo: "cmd+\\",
      },
      {
        keys: "Cmd / Ctrl + I",
        description: "Toggle preview pane",
        actionId: "browser.togglePreview",
        defaultCombo: "cmd+i",
      },
      {
        keys: "Cmd / Ctrl + R · F5",
        description: "Refresh current folder",
        actionId: "browser.refresh",
        defaultCombo: "cmd+r",
      },
      {
        keys: "Cmd / Ctrl + L",
        description: "Edit path (focus path bar)",
        actionId: "browser.focusPathBar",
        defaultCombo: "cmd+l",
      },
      {
        keys: "Cmd / Ctrl + K",
        description: "Quick-jump (bookmarks + recent)",
        actionId: "app.quickJump",
        defaultCombo: "cmd+k",
      },
      {
        keys: "Cmd / Ctrl + Shift + P",
        description: "Command palette (every action, searchable)",
        actionId: "app.commandPalette",
        defaultCombo: "cmd+shift+p",
      },
      {
        keys: "Cmd / Ctrl + ,",
        description: "Open Settings",
        actionId: "app.openSettings",
        defaultCombo: "cmd+,",
      },
      {
        keys: "Cmd / Ctrl + Shift + N",
        description: "New folder",
        actionId: "browser.newFolder",
        defaultCombo: "cmd+shift+n",
      },
      {
        keys: "Cmd / Ctrl + D",
        description: "Bookmark current folder",
        actionId: "browser.bookmarkCurrent",
        defaultCombo: "cmd+d",
      },
      {
        keys: "F2",
        description: "Rename selected entry",
        actionId: "browser.rename",
        defaultCombo: "f2",
      },
      {
        keys: "Cmd / Ctrl + =",
        description: "Font size up (S → M → L)",
        actionId: "app.fontSizeUp",
        defaultCombo: "cmd+=",
      },
      {
        keys: "Cmd / Ctrl + -",
        description: "Font size down (L → M → S)",
        actionId: "app.fontSizeDown",
        defaultCombo: "cmd+-",
      },
      {
        keys: "Cmd / Ctrl + 0",
        description: "Reset font size to medium",
        actionId: "app.fontSizeReset",
        defaultCombo: "cmd+0",
      },
      {
        keys: "Cmd / Ctrl + Shift + =",
        description: "View zoom in (larger cells / rows in the file list)",
        actionId: "app.viewZoomIn",
        defaultCombo: "cmd+shift+=",
      },
      {
        keys: "Cmd / Ctrl + Shift + -",
        description: "View zoom out (smaller cells / rows in the file list)",
        actionId: "app.viewZoomOut",
        defaultCombo: "cmd+shift+-",
      },
      {
        keys: "Cmd / Ctrl + Shift + 0",
        description: "Reset view zoom to 100 %",
        actionId: "app.viewZoomReset",
        defaultCombo: "cmd+shift+0",
      },
      {
        keys: "Cmd / Ctrl + Shift + .",
        description: "Toggle hidden files (dotfiles)",
        actionId: "app.toggleHidden",
        defaultCombo: "cmd+shift+.",
      },
    ],
  },
  {
    title: "Tabs",
    items: [
      {
        keys: "Cmd / Ctrl + T",
        description: "New tab",
        actionId: "tabs.newTab",
        defaultCombo: "cmd+t",
      },
      {
        keys: "Cmd / Ctrl + W",
        description: "Close active tab (closes the window when no tabs remain)",
        actionId: "tabs.closeTab",
        defaultCombo: "cmd+w",
      },
      {
        keys: "Cmd / Ctrl + Q",
        description: "Close all tabs and the active window",
        actionId: "app.closeWindow",
        defaultCombo: "cmd+q",
      },
      {
        keys: "Cmd / Ctrl + Shift + T",
        description: "Restore last closed tab",
        actionId: "tabs.restoreClosedTab",
        defaultCombo: "cmd+shift+t",
      },
      {
        keys: "Cmd / Ctrl + N",
        description: "Open new window",
        actionId: "app.newWindow",
        defaultCombo: "cmd+n",
      },
      // Cmd/Ctrl+1..9 — generated as 9 separate catalog entries so
      // each tab-switch keybinding can be individually rebound from
      // Settings → Keyboard.
      ...Array.from({ length: 9 }, (_, i) => ({
        keys: `Cmd / Ctrl + ${i + 1}`,
        description: `Switch to tab ${i + 1}`,
        actionId: `tabs.switchTo${i + 1}`,
        defaultCombo: `cmd+${i + 1}`,
      })),
      {
        keys: "Cmd / Ctrl + Shift + [",
        description: "Switch to previous tab",
        actionId: "tabs.cyclePrev",
        defaultCombo: "cmd+shift+[",
      },
      {
        keys: "Cmd / Ctrl + Shift + ]",
        description: "Switch to next tab",
        actionId: "tabs.cycleNext",
        defaultCombo: "cmd+shift+]",
      },
      {
        keys: "Cmd / Ctrl + Shift + ←",
        description: "Move active tab left",
        actionId: "tabs.moveLeft",
        defaultCombo: "cmd+shift+arrowleft",
      },
      {
        keys: "Cmd / Ctrl + Shift + →",
        description: "Move active tab right",
        actionId: "tabs.moveRight",
        defaultCombo: "cmd+shift+arrowright",
      },
      { keys: "Middle-click folder", description: "Open folder in new tab" },
      {
        keys: "Cmd / Ctrl + Shift + \\",
        description: "Toggle two-pane (split) mode",
        actionId: "app.toggleSplit",
        defaultCombo: "cmd+shift+\\",
      },
    ],
  },
  {
    title: "Help",
    items: [
      {
        keys: "? · F1",
        description: "Show this cheatsheet (F1 is always an alias)",
        actionId: "app.cheatsheet",
        defaultCombo: "shift+/",
      },
      { keys: "Esc", description: "Close this cheatsheet" },
    ],
  },
];
