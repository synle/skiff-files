// Settings store. Persisted to localStorage for now — Phase 6 promotes this
// to an `app_data_dir()/settings.json` file via a Rust command pair so power
// users can sync their settings across machines via dotfiles.
//
// We don't pull in zustand or jotai for a half-dozen booleans; a Context +
// reducer is enough and ships zero extra weight.
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeMode } from "../theme";
import type { ConflictPolicy } from "../api/sync";
import type { SortDir, SortKey } from "../components/FileList";
import {
  migrateLegacyDrafts,
  type SavedConnection,
} from "./connectionStore";
import { connectionId } from "../util/connectionUrl";

/** What rendering style the file list uses. Per-folder overrides land later. */
export type ViewMode = "list" | "tile" | "gallery" | "column";

/** Visual density of list rows. */
export type Density = "comfortable" | "compact";

/** Global font size scale. Maps to MUI's `typography.fontSize`. */
export type FontSize = "small" | "medium" | "large";

/** Console-log gate. The frontend `util/log` helpers compare against
 *  this and skip calls below the configured threshold. `off` mutes
 *  everything — useful for clean dev console / screencast captures. */
export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

/** Extension display policy:
 *  - `always` — append extensions to every file name (default — Explorer convention).
 *  - `never` — strip extensions from every file name (Finder default).
 *  - `whenAmbiguous` — strip for kinds with a recognizable icon (image,
 *    audio, video, pdf, text, markdown, code, archive); keep for
 *    binary / unknown so users still see what they're dealing with. */
export type ShowExtensions = "always" | "never" | "whenAmbiguous";

/** Preview pane visibility policy:
 *  - `off` — never show the pane
 *  - `imagesOnly` — auto-open when an image is selected, otherwise hidden
 *  - `always` — always show, render placeholder when no selection */
export type PreviewMode = "off" | "imagesOnly" | "always";

/** A user-pinned path for the sidebar. `label` defaults to the
 *  basename of the path but is editable; `path` is the address-bar
 *  form (so `sftp://<id>/<remote>` works alongside local paths). */
export interface Bookmark {
  /** Stable id so renames + reorders don't trip React keys. */
  id: string;
  label: string;
  path: string;
}

/** Persisted settings shape. Add new keys with sensible defaults — see DEFAULTS. */
export interface Settings {
  themeMode: ThemeMode;
  defaultView: ViewMode;
  density: Density;
  /** Global font size scale. Mapped to MUI's `typography.fontSize`. */
  fontSize: FontSize;
  showHidden: boolean;
  /** When true (default), system files like `.DS_Store`, `Thumbs.db`,
   *  `desktop.ini`, `.localized` are filtered out of the Browser
   *  listing regardless of `showHidden`. Power users on macOS who
   *  need to inspect these can disable. */
  hideSystemFiles: boolean;
  showExtensions: ShowExtensions;
  /** Right-side preview pane policy. */
  previewMode: PreviewMode;
  /** Width of the preview pane in pixels. Persisted across sessions. */
  previewWidth: number;
  /** Where the Browser opens on launch. Empty = home dir (resolved at runtime). */
  startPath: string;
  /** Pinned paths that show up in the sidebar's Bookmarks section. */
  bookmarks: Bookmark[];
  /** Auto-tracked navigation history. Most-recent first. Capped at
   *  RECENT_PATHS_TRACK_MAX so the list doesn't grow unbounded.
   *  Surfaces in the sidebar's Recent section (top N) plus the
   *  "Show all recent" dialog (full list). */
  recentPaths: string[];
  /** Favorites the user has hidden via the sidebar context menu.
   *  Stored as the relative-from-home segment (e.g. "Desktop") plus
   *  the special token "trash" for the Trash favorite. Hidden items
   *  vanish from the Sidebar but stay re-enable-able from Settings. */
  hiddenFavorites: string[];
  /** Last N unique search queries the user has run. Most-recent
   *  first. Surfaces in the toolbar's search dropdown so users can
   *  recall a query without retyping. Capped at SEARCH_HISTORY_MAX. */
  searchHistory: string[];
  /** Per-folder view mode override. The Browser falls back to
   *  `defaultView` when there's no entry for the current path.
   *  Capped at FOLDER_VIEW_MAX (LRU-style: oldest entries dropped
   *  on overflow) to keep settings.json bounded. */
  folderViewMode: Record<string, ViewMode>;
  /** Sort key applied to folders without a per-folder override. */
  defaultSortKey: SortKey;
  /** Sort direction applied to folders without a per-folder override. */
  defaultSortDir: SortDir;
  /** Per-folder sort override. Same LRU-bounded pattern as
   *  `folderViewMode`. */
  folderSort: Record<string, { key: SortKey; dir: SortDir }>;
  /** Per-folder active kind-filter groups. Empty array = no filter
   *  active. Same FOLDER_VIEW_MAX cap so settings.json stays bounded.
   *  Values match the KindGroup enum from KindFilterBar. */
  folderKindFilter: Record<string, string[]>;
  /** Per-folder active tag-filter colors. Empty array (or missing
   *  key) = no tag filter. Values are TagColor strings. Same LRU
   *  bound as folderKindFilter. */
  folderTagFilter: Record<string, string[]>;
  /** Per-folder active recency filter ("today" / "week" / "month").
   *  Same LRU bound as folderKindFilter / folderTagFilter. Missing
   *  key = no recency filter for that folder. */
  folderRecencyFilter: Record<string, string>;
  /** Default conflict policy for new sync jobs. The Transfers form
   *  reads this on mount; saved-job templates always carry their
   *  own policy and ignore this. */
  syncDefaultConflictPolicy: ConflictPolicy;
  /** Default max-size cap (GB) for new sync jobs. */
  syncDefaultMaxSizeGb: number;
  /** Default lookback-days for the skip-if-unchanged heuristic. */
  syncDefaultLookbackDays: number;
  /** Default bandwidth cap (KB/s) for new sync jobs. 0 = unlimited. */
  syncDefaultBandwidthKbps: number;
  /** Default for the "verify after copy" toggle on new sync jobs.
   *  When true, the engine re-stats each dest file and surfaces a
   *  per-file error on size mismatch. */
  syncDefaultVerifyAfterCopy: boolean;
  /** When true, the ConflictModal auto-dispatches a `skip` decision
   *  for every `sync:conflict` event without showing the modal.
   *  Useful for unattended runs / CI-style usage. The engine still
   *  fires the events; only the UI suppresses. */
  syncSuppressConflictPrompts: boolean;
  /** When true (Finder default), folders are grouped above files
   *  regardless of the active sort. When false, folders and files
   *  intermix according to the chosen sort key — useful for sorting
   *  by mtime to find "most recently touched" without folder bias. */
  groupFoldersFirst: boolean;
  /** When false, the StatusBar at the bottom of the Browser is
   *  hidden — selection summary / disk space / errors don't render.
   *  Default true. */
  showStatusBar: boolean;
  /** UI language code. Matches the bundles registered in
   *  `src/i18n/index.ts`. Falls back to `"en"` at lookup time when
   *  the value isn't a registered locale, so a stale settings.json
   *  from a future-shipped locale doesn't render keys verbatim. */
  language: string;
  /** Opt-in local crash reporting. When true, a Rust-side panic
   *  hook writes one log file per panic to
   *  `<app_data_dir>/crashes/<ts>.log`. Local-only, never
   *  submitted anywhere. Default false. The flag is read from
   *  settings.json at Rust startup, so flipping it takes effect
   *  on the next app launch (Settings → Advanced surfaces that
   *  caveat). */
  crashReportsEnabled: boolean;
  /** macOS-only: when true, the app skips the auto-open of System
   *  Settings → Privacy & Security → Full Disk Access on launch even
   *  if the FDA probe says access is denied. Flipped on by the
   *  Snackbar's "Don't show again" action so the user isn't pestered
   *  every launch after they've decided not to grant access (e.g.
   *  they only use local FS paths and don't care about ~/Library).
   *  Has no effect on non-macOS targets — the probe always returns
   *  granted there. */
  macosFdaPromptDismissed: boolean;
  /** Console log threshold. `off` drops every call routed through
   *  `util/log`; the standard hierarchy `error > warn > info > debug`
   *  controls what passes through. Default `warn`. */
  logLevel: LogLevel;
  /** Force reduced-motion regardless of OS preference. The app already
   *  honors `prefers-reduced-motion: reduce` automatically; this lets
   *  users opt in unconditionally (e.g. for VM / RDP sessions where
   *  the OS preference doesn't surface). */
  reduceMotion: boolean;
  /** When true, the OS window title shows the active tab's full path
   *  (e.g. "/Users/syle/git/skiff" instead of just "Skiff Files").
   *  Off by default to match Finder; Explorer power users sometimes
   *  want this so they can read the path from their dock / taskbar. */
  showFullPathInTitle: boolean;
  /** Sidebar visibility — toggled via Cmd/Ctrl+B. Persisted so it
   *  survives restarts. */
  sidebarVisible: boolean;
  /** Sidebar width in pixels. Drag-resize persists into here, clamped
   *  to SIDEBAR_WIDTH_MIN..SIDEBAR_WIDTH_MAX. */
  sidebarWidth: number;
  /** When true, the sidebar renders as a narrow icon-only strip
   *  (~52 px wide). Only section icons and the bottom nav icons are
   *  visible; labels and section headers are hidden. Toggled from
   *  the sidebar's own bottom nav. Default false. */
  sidebarIconOnly: boolean;
  /** Per-section collapsed state for the Sidebar. Keys are
   *  ad-hoc section ids ("favorites" / "bookmarks" / "recent" /
   *  "hosts" / "devices"); missing key = expanded (default). */
  sidebarCollapsed: Record<string, boolean>;
  /** Per-section visibility for the Sidebar. Same key set as
   *  `sidebarCollapsed`; missing key = visible (default). Lets
   *  users hide sections they don't use (e.g. someone who never
   *  uses bookmarks can hide that header entirely instead of just
   *  collapsing it). */
  sidebarSectionsVisible: Record<string, boolean>;
  /** User-controlled order of Sidebar sections. Empty array = use
   *  the built-in default (favorites → bookmarks → workspaces →
   *  searches → syncjobs → selections → recent → hosts → devices).
   *  Unknown ids in the array are ignored; ids missing from the
   *  array fall back to their default position so future-added
   *  sections don't disappear when an old `settings.json` is
   *  loaded. Re-orderable from Settings → Sidebar. */
  sidebarSectionOrder: string[];
  /** Accordion mode for the Sidebar — only one section may be
   *  expanded at a time. Expanding one auto-collapses the others.
   *  Default false (Finder-style: any number open simultaneously). */
  sidebarAccordion: boolean;
  /** Show colored status dots next to each Hosts-section entry.
   *  Default true. Hidden = the host icon column collapses to the
   *  fallback HubIcon to keep visual balance. */
  sidebarShowStatusDots: boolean;
  /** Two-pane mode (FileZilla-style): when true, the main area
   *  splits in half horizontally with two independent BrowserTabs
   *  strips. Each pane has its own tab list (`savedTabs` for the
   *  left pane, `savedTabsRight` for the right). Toggle via Cmd/Ctrl+\.
   *  Default false (single-pane). */
  twoPaneMode: boolean;
  /** Controls whether the BulkActionBar (the toolbar above the file
   *  list) renders text labels next to its icons. Three modes:
   *  - `"auto"` — show labels in single-pane mode, hide them in
   *    two-pane mode (the original 0.2.270 behavior, kept as the
   *    default so existing users see no change).
   *  - `"labels"` — always show labels regardless of pane mode.
   *  - `"icons"` — always icon-only with tooltips, regardless of
   *    pane mode. Saves vertical space and matches the Finder /
   *    Explorer toolbar feel some users prefer.
   *  Default `"auto"`. */
  bulkActionBarLabels: "auto" | "labels" | "icons";
  /** Unified saved-connections list — every SFTP / FTP / SMB
   *  connection the user has added. Replaces the three per-kind
   *  localStorage keys (`.connections.v1` / `.ftp.v1` / `.smb.v1`).
   *  Persisted as part of settings.json (mirrored from localStorage)
   *  so users see the same list across devices once cloud-sync
   *  lands. When `saveCredentialsToKeychain` is true (the default)
   *  passwords ride in the OS keychain instead of this row. */
  connections: import("./connectionStore").SavedConnection[];
  /** When true (default), the connect dialog persists saved
   *  Remember-password values in the OS keychain (macOS Keychain /
   *  Windows Credential Manager / Linux libsecret via the `keyring`
   *  Rust crate). When false, the password is written into
   *  `settings.json` alongside the rest of the connection row
   *  (the legacy "Phase 1" plaintext path). The dialog falls back to
   *  the plaintext arm automatically when the keychain probe
   *  (`credsCapable`) fails — e.g. headless Linux without
   *  secret-service — so flipping this off is only required when
   *  the user wants the file-on-disk fallback unconditionally. */
  saveCredentialsToKeychain: boolean;
  /** Ratio (0..1) of horizontal space allocated to the LEFT pane in
   *  two-pane mode. The right pane gets `1 - ratio`. Drag the divider
   *  between the panes to update. Clamped to [0.15, 0.85] so neither
   *  pane can collapse below a usable width. Default 0.5 (even split). */
  twoPaneSplitRatio: number;
  /** Per-column pixel widths for the FileList list-view. Drag the
   *  right edge of any column header to resize. Clamped per-column to
   *  the LIST_COL_WIDTH_MIN/MAX bands; `name` is implicitly the
   *  remaining flex space so it isn't stored here. */
  listColumnWidths: { size: number; modified: number; kind: number };
  /** Tabs persisted for the RIGHT pane in two-pane mode. Empty in
   *  single-pane mode (BrowserTabs spawns a default Home on first
   *  mount). Capped at TABS_MAX. */
  savedTabsRight: SavedTab[];
  /** Active tab id for the RIGHT pane. */
  savedActiveTabIdRight: string | null;
  /** LRU stack of recently-closed tabs across both panes. Persists
   *  across restarts so Cmd/Ctrl+Shift+T after relaunch can resurrect
   *  the last-closed tab. Capped at 10. */
  recentlyClosedTabs: SavedTab[];
  /** When true, Cmd/Ctrl+T (and the toolbar +) seeds the new tab at
   *  the active tab's current path instead of the home directory.
   *  Useful for power users who frequently spawn parallel tabs from
   *  the folder they're already viewing. Default false (Chrome
   *  convention: new tab = home). */
  openNewTabAtCurrent: boolean;
  /** Tabs the user had open at last save. Capped at TABS_MAX so a
   *  runaway browsing session doesn't bloat settings.json. Empty
   *  array = no persisted tabs (BrowserTabs will spawn a default). */
  savedTabs: SavedTab[];
  /** Active tab id at last save. The matching savedTabs entry is
   *  selected on launch; if it's missing the first tab wins. */
  savedActiveTabId: string | null;
  /** Opt-in custom palette overrides. When `useCustomTheme` is true,
   *  the theme builder reads `customLightPalette` / `customDarkPalette`
   *  instead of the built-in palettes. Each field is a hex string;
   *  unset (empty) keeps the built-in default for that slot.  */
  useCustomTheme: boolean;
  customLightPalette: CustomPalette;
  customDarkPalette: CustomPalette;
  /** Per-action keyboard binding overrides. Key = action id from
   *  the shortcut catalog. Value = combo string ("ctrl+shift+p")
   *  or `null` to mean the user has disabled the binding entirely.
   *  Missing key = use the default combo. Only a starter set of
   *  actions are wired today (palette / quick-jump / settings);
   *  the rest of the catalog is read-only until their handlers
   *  migrate to the same `matchesCombo` lookup. */
  shortcutOverrides: Record<string, string | null>;
  /** Per-path color tag, Finder-style. Keys are full paths
   *  (local or sftp://). Values are TagColor enum strings. Capped
   *  at FOLDER_VIEW_MAX entries via the same LRU pattern as
   *  folderViewMode / folderSort / folderKindFilter. Missing key =
   *  no tag. */
  fileTags: Record<string, TagColor>;
  /** Format used for the FileList Modified + Created columns.
   *  - "locale": Date.prototype.toLocaleString (default — matches OS locale)
   *  - "iso": ISO-8601, sortable, locale-independent
   *  - "short": YYYY-MM-DD HH:mm (compact)
   *  - "relative": "5m ago" / "3h ago" / "2d ago" — human-friendly */
  dateFormat: DateFormat;
  /** Whether the bottom-right OperationsDrawer renders expanded
   *  (showing each in-flight job's progress widget) or collapsed
   *  to just the header. Persists so a user who collapses the
   *  drawer doesn't have it re-expand on every new job. */
  operationsDrawerExpanded: boolean;
  /** How many recent-path entries the Sidebar's Recent section shows
   *  inline. 0 disables recent-path tracking entirely (the array is
   *  also wiped). Tracking always retains up to RECENT_PATHS_TRACK_MAX
   *  entries on disk; the "Show all recent" dialog surfaces the rest. */
  recentPathsMax: number;
  /** Per-extension override of the icon kind. Keys are extensions
   *  WITHOUT the leading dot (e.g. "rs", "tex"); values are FileKind
   *  strings ("code" / "document" / "image" / etc.). The Rust-side
   *  kind detection runs first; a matching override here replaces it
   *  in the UI. Only the icon column reads the override — sort-by-
   *  kind continues to use the underlying value to avoid resorting
   *  the listing every time the user tweaks this map. */
  customFileKinds: Record<string, string>;
  /** FileList column visibility (list view only — grid views use a
   *  single cell). The `name` column is always visible; the others
   *  toggle. Useful in narrow windows or when the user only cares
   *  about the file name. */
  hideColumns: { size: boolean; modified: boolean; kind: boolean };
  /** Whether the window should stay above other apps. Useful for
   *  drag-dropping files OUT of Skiff into apps whose window would
   *  otherwise cover us. Synced via the new `window_set_always_on_top`
   *  Tauri command on every change. */
  alwaysOnTop: boolean;
  /** Multiplier applied to every view mode's base cell / row size.
   *  1.0 = built-in defaults; clamped to [0.5, 2.0] in the UI. List
   *  view scales row height; tile / gallery / column scale cell
   *  width + height + icon size proportionally. Drives the zoom
   *  cluster in the StatusBar. Stored as a single global value
   *  (not per-view) — view-distinctness is preserved because the
   *  base sizes still differ across modes. */
  viewZoom: number;
  /** User-saved searches: label + query + flags. Surfaces in a small
   *  dropdown next to the toolbar's search field; clicking restores
   *  the query + flags and runs the search. Distinct from
   *  searchHistory which is auto-tracked + capped + label-less. */
  savedSearches: SavedSearch[];
  /** Named selection groups — capture the current multi-selection
   *  under a label so users can re-select the same N paths later
   *  without re-clicking each one. Restoration happens against the
   *  current folder: any path in the group that still exists there
   *  is selected; missing paths are silently dropped. Capped at 50
   *  entries; oldest insertion-order entries dropped on overflow. */
  savedSelections: SavedSelection[];
  /** Named tab workspaces — labeled snapshots of the tab strip
   *  saved on demand. Useful for context switching ("project A
   *  needs these 5 tabs, project B needs these 4"). Capped at 20
   *  workspaces; oldest entries dropped on overflow. */
  tabWorkspaces: TabWorkspace[];
  /** Saved Skiffsync job templates. Migrated from localStorage in
   *  0.2.228; previously stored under `skiff-files.savedJobs.v1`. */
  savedSyncJobs: SavedSyncJob[];
}

/** Saved Skiffsync job template. The label defaults to `<src> → <dest>`
 *  but is editable from Settings → Saved data. */
export interface SavedSyncJob {
  id: string;
  label: string;
  planner: "local" | "repo";
  src: string;
  dest: string;
  maxSizeGb: number;
  lookbackDays: number;
  conflictPolicy: string;
  /** Optional — pre-0.2.51 saves don't have this; runner falls
   *  back to the current Settings default. */
  bandwidthKbps?: number;
  /** Optional — pre-0.2.53 saves don't have this; runner falls
   *  back to the current Settings default. */
  verifyAfterCopy?: boolean;
}

export interface TabWorkspace {
  id: string;
  label: string;
  /** ms-since-epoch wall-clock save time. Surfaces in the palette
   *  hint so users can tell stale workspaces apart. */
  savedAt: number;
  /** Snapshot of the tab strip at save time (uses the same shape
   *  as `savedTabs`). */
  tabs: SavedTab[];
}

export interface SavedSelection {
  id: string;
  label: string;
  paths: string[];
  /** Wall-clock save timestamp (ms). Surfaces in the palette hint
   *  so users can tell stale groups apart. */
  savedAt: number;
}

export interface SavedSearch {
  id: string;
  label: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  recursive: boolean;
}

export type DateFormat = "locale" | "iso" | "short" | "relative";

/** Finder's seven-color palette. Stored as an enum so the colors
 *  themselves can shift with the active theme without touching every
 *  user's settings.json. */
export type TagColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "gray";

/** User-editable palette slots. Maps directly onto MUI's `palette`
 *  options; theme builder spreads them in when `useCustomTheme` is
 *  true. Empty string = inherit the built-in default for that slot. */
export interface CustomPalette {
  primaryMain: string;
  backgroundDefault: string;
  backgroundPaper: string;
  textPrimary: string;
  textSecondary: string;
}

/** Persisted tab descriptor — id is stable across restarts so the
 *  user-visible position survives. */
export interface SavedTab {
  id: string;
  label: string;
  initialPath: string;
  /** Pinned tabs survive bulk-close actions and render at the
   *  front of the strip with a smaller width. Optional — undefined
   *  is equivalent to false so existing settings.json files round-
   *  trip without migration. */
  pinned?: boolean;
  /** User-supplied label that overrides the auto-derived basename.
   *  Set via right-click → Rename tab… on a tab; cleared by saving
   *  an empty string. Optional so existing settings.json round-trips
   *  without migration. */
  customLabel?: string;
}

/** Max tabs we restore. 20 is well past anyone's reasonable usage
 *  but cheap to cap. */
export const TABS_MAX = 20;

/** Sidebar width clamps. Below the min the sections are unreadable;
 *  above the max the file pane gets cramped on small windows. */
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 400;
export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_ICON = 52;

/** Preview pane width clamps. Below the min the image fits in a
 *  postage stamp; above the max the file list gets cramped. */
export const PREVIEW_WIDTH_MIN = 240;
export const PREVIEW_WIDTH_MAX = 720;

/** Two-pane split ratio clamps. 15% / 85% keeps either pane wide
 *  enough to show at least one column of file names. */
export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;

/** Per-column width clamps for FileList list-view. Below the min the
 *  header label gets clipped; above the max the Name column starves. */
export const LIST_COL_WIDTH_MIN = 60;
export const LIST_COL_WIDTH_MAX = 400;

/** Max entries kept in `recentPaths` regardless of the sidebar
 *  display count. 200 keeps the "Show all recent" dialog useful
 *  for a busy day's history while staying bounded on disk. */
export const RECENT_PATHS_TRACK_MAX = 200;
/** Backwards-compatibility alias — historically the sidebar display
 *  cap and the storage cap were the same value. Kept as an export so
 *  external imports don't break; new code should use the
 *  `recentPathsMax` setting (sidebar count) or
 *  `RECENT_PATHS_TRACK_MAX` (storage cap) directly. */
export const RECENT_PATHS_MAX = RECENT_PATHS_TRACK_MAX;
/** Cap on persisted search queries. 10 is enough to recall this
 *  morning's hunting and short enough to fit in a small dropdown. */
export const SEARCH_HISTORY_MAX = 10;

/** Max entries kept in `folderViewMode`. Settings.json grows by ~80
 *  bytes per entry; 200 caps the file at ~16 KB. */
export const FOLDER_VIEW_MAX = 200;

/** Built-in default order for Sidebar sections. The Sidebar +
 *  Settings reorder UI both reference this so an empty
 *  `sidebarSectionOrder` falls back to the same positions. New
 *  sections added later should be appended here so existing users
 *  see them at the bottom (their saved order can promote them). */
export const SIDEBAR_SECTION_DEFAULT_ORDER = [
  "favorites",
  "bookmarks",
  "workspaces",
  "searches",
  "syncjobs",
  "selections",
  "recent",
  "hosts",
  "devices",
] as const;

/** Friendly labels for each sidebar section id. Used by the
 *  Settings reorder UI; the Sidebar still passes its own labels in
 *  case a future section wants a per-locale override. */
export const SIDEBAR_SECTION_LABELS: Record<string, string> = {
  favorites: "Favorites",
  bookmarks: "Bookmarks",
  workspaces: "Workspaces",
  searches: "Searches",
  syncjobs: "Sync jobs",
  selections: "Selections",
  recent: "Recent",
  hosts: "Network",
  devices: "Devices",
};

export const DEFAULTS: Settings = {
  themeMode: "system",
  defaultView: "list",
  density: "comfortable",
  fontSize: "medium",
  showHidden: false,
  hideSystemFiles: true,
  showExtensions: "always",
  previewMode: "imagesOnly",
  previewWidth: 320,
  startPath: "",
  bookmarks: [],
  recentPaths: [],
  hiddenFavorites: [],
  searchHistory: [],
  folderViewMode: {},
  defaultSortKey: "name",
  defaultSortDir: "asc",
  folderSort: {},
  folderKindFilter: {},
  folderTagFilter: {},
  folderRecencyFilter: {},
  // Default to "prompt" so file collisions during paste / drag-drop
  // surface the TeraCopy-style modal (Keep both / Overwrite /
  // Overwrite if older / Overwrite if size differs / Skip — plus
  // their "Apply to all" variants). Earlier default "skip" silently
  // dropped colliding files, which looked exactly like a stalled
  // copy from the user's POV. Power users who prefer auto-skip can
  // flip this back in Settings → Skiffsync.
  syncDefaultConflictPolicy: "prompt",
  syncDefaultMaxSizeGb: 1,
  syncDefaultLookbackDays: 7,
  syncDefaultBandwidthKbps: 0,
  syncDefaultVerifyAfterCopy: false,
  syncSuppressConflictPrompts: false,
  groupFoldersFirst: true,
  reduceMotion: false,
  logLevel: "warn",
  showStatusBar: true,
  language: "en",
  crashReportsEnabled: false,
  macosFdaPromptDismissed: false,
  showFullPathInTitle: false,
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarIconOnly: false,
  sidebarCollapsed: {},
  // Recent is hidden by default — the Recent section was visually
  // heavy in 0.2.272's sidebar (double-line entries, full paths) and
  // most users don't need it on. Re-enable from Settings → Sidebar.
  sidebarSectionsVisible: { recent: false },
  sidebarSectionOrder: [],
  sidebarAccordion: false,
  sidebarShowStatusDots: true,
  openNewTabAtCurrent: false,
  twoPaneMode: false,
  bulkActionBarLabels: "auto",
  connections: [],
  saveCredentialsToKeychain: true,
  twoPaneSplitRatio: 0.5,
  listColumnWidths: { size: 96, modified: 180, kind: 120 },
  savedTabsRight: [],
  savedActiveTabIdRight: null,
  recentlyClosedTabs: [],
  savedTabs: [],
  savedActiveTabId: null,
  useCustomTheme: false,
  customLightPalette: {
    primaryMain: "",
    backgroundDefault: "",
    backgroundPaper: "",
    textPrimary: "",
    textSecondary: "",
  },
  customDarkPalette: {
    primaryMain: "",
    backgroundDefault: "",
    backgroundPaper: "",
    textPrimary: "",
    textSecondary: "",
  },
  shortcutOverrides: {},
  fileTags: {},
  dateFormat: "locale",
  operationsDrawerExpanded: true,
  recentPathsMax: 10,
  customFileKinds: {},
  hideColumns: { size: false, modified: false, kind: false },
  alwaysOnTop: false,
  viewZoom: 1,
  savedSearches: [],
  savedSelections: [],
  tabWorkspaces: [],
  savedSyncJobs: [],
};

const STORAGE_KEY = "skiff-files.settings.v1";

/** Rewrite any occurrence of `<scheme>://<oldId>/...` to use the new
 *  id. Walks the path once for each renamed connection. No-op when
 *  `renamed` is empty (the common steady-state case after the first
 *  post-upgrade run). Pure helper — exported for tests. */
export function rewritePathIds(
  path: string,
  renamed: Map<string, string>,
): string {
  if (!path || renamed.size === 0) return path;
  for (const [oldId, newId] of renamed) {
    // Match `<scheme>://<oldId>` followed by `/` or end-of-string.
    // Anchoring on `/` keeps us from rewriting an id that happens to
    // be a prefix of another id. Schemes are fixed (sftp / ftp / smb).
    for (const scheme of ["sftp", "ftp", "smb"] as const) {
      const needle = `${scheme}://${oldId}`;
      if (path.startsWith(needle)) {
        const tail = path.slice(needle.length);
        if (tail === "" || tail.startsWith("/")) {
          return `${scheme}://${newId}${tail}`;
        }
      }
    }
  }
  return path;
}

/** Migrate connection ids from synthetic (`smb-1779235589933`, UUIDs)
 *  to canonical URL identity (`admin@host:445`). Returns the rewritten
 *  list plus a `renamed` map old→new so caller can fix up any path
 *  references in other settings surfaces. Idempotent — entries whose
 *  id is already the canonical form pass through unchanged. */
export function migrateConnectionIds(
  list: SavedConnection[],
): { connections: SavedConnection[]; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  const seen = new Set<string>();
  const out: SavedConnection[] = [];
  for (const c of list) {
    const desired = connectionId({
      kind: c.kind,
      host: c.host,
      port: c.port,
      user: c.user || (c.kind === "ftp" ? "anonymous" : c.kind === "smb" ? "guest" : "user"),
    });
    if (c.id !== desired) renamed.set(c.id, desired);
    // Collapse duplicates that map to the same canonical id —
    // last-write-wins matches the runtime upsert behaviour.
    if (seen.has(desired)) {
      const idx = out.findIndex((x) => x.id === desired);
      if (idx >= 0) out[idx] = { ...c, id: desired };
    } else {
      out.push({ ...c, id: desired });
      seen.add(desired);
    }
  }
  return { connections: out, renamed };
}

/** Migrate a parsed payload from older schema shapes. Currently:
 *  - `showExtensions` was a `boolean` until 0.2.65; coerce it to the
 *    new enum so Settings.json round-trips cleanly across versions.
 *  - `connections` was three separate localStorage keys (per-kind
 *    drafts) until the merged Connections list landed; fold those
 *    into a unified array on first read. Idempotent — running
 *    against an already-migrated payload is a no-op.
 *  - `connections[].id` was a synthetic timestamp / uuid until 0.2.309;
 *    rewrite to canonical URL identity (`user@host:port`) so the
 *    internal URL matches the OS-native URL. Path-bearing surfaces
 *    (`recentPaths`, `bookmarks`, `savedTabs`, …) are walked to swap
 *    any `<scheme>://<oldId>/...` references for the new id. */
function migrate(parsed: Record<string, unknown>): Partial<Settings> {
  if (typeof parsed.showExtensions === "boolean") {
    parsed.showExtensions = parsed.showExtensions ? "always" : "never";
  }
  const existing = Array.isArray(parsed.connections)
    ? (parsed.connections as SavedConnection[])
    : [];
  const folded = migrateLegacyDrafts(existing);
  const { connections, renamed } = migrateConnectionIds(folded);
  parsed.connections = connections;
  if (renamed.size > 0) {
    // Walk every path-bearing surface in settings and rewrite stale
    // `<scheme>://<oldId>/...` prefixes. Each surface is handled
    // defensively (typeof guards) because a corrupt/older payload
    // may not have every key in the expected shape.
    const rewriteStr = (p: unknown): unknown =>
      typeof p === "string" ? rewritePathIds(p, renamed) : p;
    const rewriteArr = (arr: unknown): unknown =>
      Array.isArray(arr) ? arr.map(rewriteStr) : arr;
    parsed.recentPaths = rewriteArr(parsed.recentPaths);
    parsed.searchHistory = rewriteArr(parsed.searchHistory);
    if (typeof parsed.startPath === "string") {
      parsed.startPath = rewritePathIds(parsed.startPath, renamed);
    }
    if (Array.isArray(parsed.bookmarks)) {
      parsed.bookmarks = (parsed.bookmarks as unknown[]).map((b) => {
        if (b && typeof b === "object" && "path" in b) {
          return { ...b, path: rewriteStr((b as { path: unknown }).path) };
        }
        return b;
      });
    }
    const rewriteTabs = (tabs: unknown): unknown =>
      Array.isArray(tabs)
        ? tabs.map((t) => {
            if (t && typeof t === "object" && "initialPath" in t) {
              return {
                ...t,
                initialPath: rewriteStr(
                  (t as { initialPath: unknown }).initialPath,
                ),
              };
            }
            return t;
          })
        : tabs;
    parsed.savedTabs = rewriteTabs(parsed.savedTabs);
    parsed.savedTabsRight = rewriteTabs(parsed.savedTabsRight);
    parsed.recentlyClosedTabs = rewriteTabs(parsed.recentlyClosedTabs);
    if (Array.isArray(parsed.tabWorkspaces)) {
      parsed.tabWorkspaces = (parsed.tabWorkspaces as unknown[]).map((w) => {
        if (w && typeof w === "object" && "tabs" in w) {
          return { ...w, tabs: rewriteTabs((w as { tabs: unknown }).tabs) };
        }
        return w;
      });
    }
    if (Array.isArray(parsed.savedSyncJobs)) {
      parsed.savedSyncJobs = (parsed.savedSyncJobs as unknown[]).map((j) => {
        if (j && typeof j === "object") {
          const job = j as { src?: unknown; dest?: unknown };
          return { ...j, src: rewriteStr(job.src), dest: rewriteStr(job.dest) };
        }
        return j;
      });
    }
    if (Array.isArray(parsed.savedSelections)) {
      parsed.savedSelections = (parsed.savedSelections as unknown[]).map((s) => {
        if (s && typeof s === "object" && "paths" in s) {
          return {
            ...s,
            paths: rewriteArr((s as { paths: unknown }).paths),
          };
        }
        return s;
      });
    }
    // Path-keyed object maps — rebuild with new keys.
    const rewriteKeys = (obj: unknown): unknown => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[rewritePathIds(k, renamed)] = v;
      }
      return out;
    };
    parsed.fileTags = rewriteKeys(parsed.fileTags);
    parsed.folderViewMode = rewriteKeys(parsed.folderViewMode);
    parsed.folderSort = rewriteKeys(parsed.folderSort);
    parsed.folderKindFilter = rewriteKeys(parsed.folderKindFilter);
    parsed.folderTagFilter = rewriteKeys(parsed.folderTagFilter);
    parsed.folderRecencyFilter = rewriteKeys(parsed.folderRecencyFilter);
  }
  return parsed as Partial<Settings>;
}

/** Read settings from localStorage, merging missing keys against DEFAULTS so a
 *  newer build picking up an older payload doesn't end up with `undefined`s. */
export function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Run migrate even when there's no stored settings payload so
    // first-launch upgrades from older builds (which kept per-kind
    // drafts in separate localStorage keys) still pick up the
    // legacy entries.
    const parsed = migrate(
      raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
    );
    return { ...DEFAULTS, ...parsed };
  } catch {
    // Corrupt JSON should not brick the app — fall back to defaults silently.
    return { ...DEFAULTS };
  }
}

/** Persist the full settings object. Failures are swallowed (private mode etc.). */
export function saveSettings(s: Settings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/**
 * Load settings from disk via Tauri. Returns the parsed settings or
 * `null` if no file exists yet. Errors (e.g. running outside Tauri,
 * or `app_data_dir` denied) resolve to `null` so callers can fall
 * back to localStorage cleanly. Never throws.
 */
export async function loadSettingsFromDisk(): Promise<Settings | null> {
  try {
    const raw = await invoke<string | null>("settings_load");
    if (!raw) return null;
    const parsed = migrate(JSON.parse(raw) as Record<string, unknown>);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return null;
  }
}

/** Save settings to disk via Tauri. Fire-and-forget; localStorage stays
 *  in sync as a hot cache so the next page load doesn't have to await
 *  the Rust call. */
export async function saveSettingsToDisk(s: Settings): Promise<void> {
  try {
    await invoke<void>("settings_save", { json: JSON.stringify(s) });
  } catch {
    /* ignore — localStorage covers us */
  }
}

/** Path to the OS app data directory. Resolved by Tauri (varies by
 *  platform: ~/Library/Application Support/com.synle.skiff-files on
 *  macOS, %APPDATA%\com.synle.skiff-files on Windows, etc.). The
 *  Rust side mkdir-p's it before returning. */
export async function appDataDir(): Promise<string | null> {
  try {
    return await invoke<string>("settings_app_data_dir");
  } catch {
    return null;
  }
}

/** Path to the crash-log directory used by the opt-in panic hook
 *  (`crashReportsEnabled`). Returned even when reporting is off so
 *  the Settings UI can offer "Reveal" without a separate gate. */
export async function crashLogsDir(): Promise<string | null> {
  try {
    return await invoke<string>("crash_logs_dir");
  } catch {
    return null;
  }
}

/** Number of `.log` files in the crash directory. 0 when the
 *  directory is missing (the common case — reporting off). */
export async function crashLogsCount(): Promise<number> {
  try {
    return await invoke<number>("crash_logs_count");
  } catch {
    return 0;
  }
}

interface Ctx {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  /** Convenience: patch a single key without re-spreading at every callsite. */
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Restore defaults — used by Settings → Advanced → Reset. */
  reset: () => void;
}

const SettingsContext = createContext<Ctx | undefined>(undefined);

/** Provider wraps the app so any descendant can `useSettings()`. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  // Initial state seeds from localStorage so the first paint is instant.
  // We then race a Tauri disk-load and overwrite if the on-disk version
  // exists. Tests + browser-mode dev see localStorage only, which is fine.
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Wire the log-level gate so `util/log` reads the live value on every
  // call. Re-registers after every settings change so a mid-session
  // toggle takes effect without restarting.
  useEffect(() => {
    void import("../util/log").then(({ setLogLevelGetter }) => {
      setLogLevelGetter(() => settings.logLevel);
    });
  }, [settings.logLevel]);

  // Sync the live i18n locale to the persisted preference. Lazy-
  // imported so tests / hot paths that never touch i18n don't pay
  // the bundle cost. main.tsx seeds the initial language at startup;
  // this effect is the runtime "Language" picker plumbing.
  useEffect(() => {
    void import("../i18n").then(({ default: i18n }) => {
      if (i18n.language !== settings.language) {
        void i18n.changeLanguage(settings.language);
      }
    });
  }, [settings.language]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromDisk = await loadSettingsFromDisk();
      if (!cancelled && fromDisk) setSettings(fromDisk);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every VALUE change (not every reference change) to
  // BOTH localStorage (hot cache for next mount) and disk via Tauri
  // (durable across reinstalls / dotfile sync). The JSON-equality
  // dedup is critical: the cross-window settings sync listener
  // reloads from disk and calls setSettings with a fresh object ref
  // even when values are identical. Without this dedup, the persist
  // effect would re-fire → save → emit → reload → … infinite loop.
  // Manifested in 0.2.137 as the view-mode oscillation in single-
  // window mode (the disk-equality guard in App.tsx alone wasn't
  // enough — by the time the listener compared, the source window
  // had already re-armed its own persist effect via setSettings).
  const lastSavedJsonRef = useRef<string>("");
  useEffect(() => {
    const json = JSON.stringify(settings);
    if (json === lastSavedJsonRef.current) return;
    lastSavedJsonRef.current = json;
    saveSettings(settings);
    void saveSettingsToDisk(settings);
  }, [settings]);

  const update = useCallback<Ctx["update"]>((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings({ ...DEFAULTS }), []);

  const value = useMemo<Ctx>(
    () => ({ settings, setSettings, update, reset }),
    [settings, update, reset],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

/** Access the settings context. Throws if used outside the provider — that's
 *  by design; a silent default would mask provider-placement bugs. */
export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used inside <SettingsProvider>");
  }
  return ctx;
}
