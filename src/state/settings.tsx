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
   *  RECENT_PATHS_MAX so the list doesn't grow unbounded. Surfaces in
   *  the sidebar's Recent section. */
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
  /** Cap on `recentPaths` length. 0 disables tracking entirely. The
   *  Sidebar's Recent section always shows up to 5 entries from the
   *  head of the list regardless of the cap. */
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
  /** User-saved searches: label + query + flags. Surfaces in a small
   *  dropdown next to the toolbar's search field; clicking restores
   *  the query + flags and runs the search. Distinct from
   *  searchHistory which is auto-tracked + capped + label-less. */
  savedSearches: SavedSearch[];
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

/** Preview pane width clamps. Below the min the image fits in a
 *  postage stamp; above the max the file list gets cramped. */
export const PREVIEW_WIDTH_MIN = 240;
export const PREVIEW_WIDTH_MAX = 720;

/** Max entries kept in `recentPaths`. 10 is enough to cover a normal
 *  day's navigation without making the sidebar scroll forever. */
export const RECENT_PATHS_MAX = 10;
/** Cap on persisted search queries. 10 is enough to recall this
 *  morning's hunting and short enough to fit in a small dropdown. */
export const SEARCH_HISTORY_MAX = 10;

/** Max entries kept in `folderViewMode`. Settings.json grows by ~80
 *  bytes per entry; 200 caps the file at ~16 KB. */
export const FOLDER_VIEW_MAX = 200;

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
  syncDefaultConflictPolicy: "skip",
  syncDefaultMaxSizeGb: 1,
  syncDefaultLookbackDays: 7,
  syncDefaultBandwidthKbps: 0,
  syncDefaultVerifyAfterCopy: false,
  syncSuppressConflictPrompts: false,
  groupFoldersFirst: true,
  reduceMotion: false,
  logLevel: "warn",
  showStatusBar: true,
  showFullPathInTitle: false,
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarCollapsed: {},
  sidebarSectionsVisible: {},
  sidebarAccordion: false,
  sidebarShowStatusDots: true,
  openNewTabAtCurrent: false,
  twoPaneMode: false,
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
  savedSearches: [],
};

const STORAGE_KEY = "skiff-files.settings.v1";

/** Migrate a parsed payload from older schema shapes. Currently:
 *  - `showExtensions` was a `boolean` until 0.2.65; coerce it to the
 *    new enum so Settings.json round-trips cleanly across versions. */
function migrate(parsed: Record<string, unknown>): Partial<Settings> {
  if (typeof parsed.showExtensions === "boolean") {
    parsed.showExtensions = parsed.showExtensions ? "always" : "never";
  }
  return parsed as Partial<Settings>;
}

/** Read settings from localStorage, merging missing keys against DEFAULTS so a
 *  newer build picking up an older payload doesn't end up with `undefined`s. */
export function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = migrate(JSON.parse(raw) as Record<string, unknown>);
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
