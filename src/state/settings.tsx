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
import type { ThemeMode } from "../theme";

/** What rendering style the file list uses. Per-folder overrides land later. */
export type ViewMode = "list" | "tile" | "gallery" | "column";

/** Visual density of list rows. */
export type Density = "comfortable" | "compact";

/** Preview pane visibility policy:
 *  - `off` — never show the pane
 *  - `imagesOnly` — auto-open when an image is selected, otherwise hidden
 *  - `always` — always show, render placeholder when no selection */
export type PreviewMode = "off" | "imagesOnly" | "always";

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
}

export const DEFAULTS: Settings = {
  themeMode: "system",
  defaultView: "list",
  density: "comfortable",
  showHidden: false,
  showExtensions: true,
  previewMode: "imagesOnly",
  previewWidth: 320,
  startPath: "",
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
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Persist on every change. The cost is one `JSON.stringify` per setting
  // tweak; settings are tiny so this is fine.
  useEffect(() => {
    saveSettings(settings);
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
