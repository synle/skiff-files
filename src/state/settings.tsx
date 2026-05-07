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
  showHidden: boolean;
  showExtensions: boolean;
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
  /** Tabs the user had open at last save. Capped at TABS_MAX so a
   *  runaway browsing session doesn't bloat settings.json. Empty
   *  array = no persisted tabs (BrowserTabs will spawn a default). */
  savedTabs: SavedTab[];
  /** Active tab id at last save. The matching savedTabs entry is
   *  selected on launch; if it's missing the first tab wins. */
  savedActiveTabId: string | null;
}

/** Persisted tab descriptor — id is stable across restarts so the
 *  user-visible position survives. */
export interface SavedTab {
  id: string;
  label: string;
  initialPath: string;
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

/** Max entries kept in `folderViewMode`. Settings.json grows by ~80
 *  bytes per entry; 200 caps the file at ~16 KB. */
export const FOLDER_VIEW_MAX = 200;

export const DEFAULTS: Settings = {
  themeMode: "system",
  defaultView: "list",
  density: "comfortable",
  showHidden: false,
  showExtensions: true,
  previewMode: "imagesOnly",
  previewWidth: 320,
  startPath: "",
  bookmarks: [],
  recentPaths: [],
  folderViewMode: {},
  defaultSortKey: "name",
  defaultSortDir: "asc",
  folderSort: {},
  syncDefaultConflictPolicy: "skip",
  syncDefaultMaxSizeGb: 1,
  syncDefaultLookbackDays: 7,
  syncDefaultBandwidthKbps: 0,
  syncDefaultVerifyAfterCopy: false,
  syncSuppressConflictPrompts: false,
  groupFoldersFirst: true,
  reduceMotion: false,
  showFullPathInTitle: false,
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarCollapsed: {},
  sidebarSectionsVisible: {},
  sidebarAccordion: false,
  savedTabs: [],
  savedActiveTabId: null,
};

const STORAGE_KEY = "skiff-files.settings.v1";

/** Read settings from localStorage, merging missing keys against DEFAULTS so a
 *  newer build picking up an older payload doesn't end up with `undefined`s. */
export function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
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
    const parsed = JSON.parse(raw) as Partial<Settings>;
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

  // Persist on every change to BOTH localStorage (hot cache for next
  // mount) and disk via Tauri (durable across reinstalls / dotfile
  // sync). The cost is one JSON.stringify per setting tweak; tiny.
  useEffect(() => {
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
