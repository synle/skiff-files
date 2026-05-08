import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  DEFAULTS,
  SettingsProvider,
  loadSettings,
  loadSettingsFromDisk,
  saveSettings,
  saveSettingsToDisk,
  useSettings,
} from "./settings";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  localStorage.clear();
});

describe("loadSettings / saveSettings", () => {
  it("returns DEFAULTS when storage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it("round-trips a saved object", () => {
    const next = { ...DEFAULTS, themeMode: "dark" as const };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
  });

  it("merges partial saved payloads against DEFAULTS", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ themeMode: "light" }),
    );
    expect(loadSettings()).toEqual({ ...DEFAULTS, themeMode: "light" });
  });

  it("falls back to DEFAULTS on corrupt JSON", () => {
    localStorage.setItem("skiff-files.settings.v1", "{not json");
    expect(loadSettings()).toEqual(DEFAULTS);
  });
});

/** Tiny consumer used to assert the provider plumbing works. */
function Probe() {
  const { settings, update, reset } = useSettings();
  return (
    <>
      <div data-testid="theme">{settings.themeMode}</div>
      <button onClick={() => update("themeMode", "dark")}>set dark</button>
      <button onClick={() => reset()}>reset</button>
    </>
  );
}

describe("SettingsProvider", () => {
  it("supplies defaults to consumers", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe(DEFAULTS.themeMode);
  });

  it("propagates updates and persists to storage", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => {
      screen.getByText("set dark").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(loadSettings().themeMode).toBe("dark");
  });

  it("reset() restores defaults", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => {
      screen.getByText("set dark").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    act(() => {
      screen.getByText("reset").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe(DEFAULTS.themeMode);
  });
});

describe("loadSettingsFromDisk / saveSettingsToDisk", () => {
  it("returns null when settings_load returns null", async () => {
    mocked.mockResolvedValueOnce(null);
    const out = await loadSettingsFromDisk();
    expect(out).toBeNull();
  });

  it("merges disk payload against DEFAULTS", async () => {
    mocked.mockResolvedValueOnce(JSON.stringify({ themeMode: "dark" }));
    const out = await loadSettingsFromDisk();
    expect(out).toMatchObject({ ...DEFAULTS, themeMode: "dark" });
  });

  it("returns null when settings_load throws", async () => {
    mocked.mockRejectedValueOnce(new Error("no app_data_dir"));
    const out = await loadSettingsFromDisk();
    expect(out).toBeNull();
  });

  it("saveSettingsToDisk invokes settings_save with stringified JSON", async () => {
    mocked.mockResolvedValueOnce(undefined);
    await saveSettingsToDisk({ ...DEFAULTS, themeMode: "dark" });
    expect(mocked).toHaveBeenLastCalledWith("settings_save", {
      json: expect.stringContaining('"themeMode":"dark"'),
    });
  });

  it("DEFAULTS includes the new folderViewMode + recentPaths + bookmarks fields", () => {
    expect(DEFAULTS.folderViewMode).toEqual({});
    expect(DEFAULTS.recentPaths).toEqual([]);
    expect(DEFAULTS.bookmarks).toEqual([]);
  });

  it("saved settings without folderViewMode get merged against DEFAULTS", () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ themeMode: "dark" }),
    );
    const out = loadSettings();
    expect(out.themeMode).toBe("dark");
    expect(out.folderViewMode).toEqual({});
  });
});

/**
 * Regression: the persist effect MUST dedup by value (JSON), not just react
 * to settings reference changes. Otherwise the cross-window settings sync
 * (App.tsx listener calls setSettings(fromDisk) on every emit, producing a
 * fresh object reference even when values are identical) would feed back
 * into the persist effect → settings_save → emit → listener → setSettings
 * → persist → … infinite loop, manifesting as the view-mode oscillation
 * fixed in 0.2.138. This test pins the value-equality dedup so a future
 * refactor doesn't accidentally re-introduce the loop.
 */
describe("persist effect dedup (regression for the cross-window loop)", () => {
  /** Probe that lets the test reach setSettings directly so we can simulate
   *  the "listener pushed an equal-by-value object" path that the bug
   *  required. */
  function PersistProbe({
    onReady,
  }: {
    onReady: (api: {
      setSettings: (s: typeof DEFAULTS) => void;
      updateTheme: () => void;
    }) => void;
  }) {
    const { settings, setSettings, update } = useSettings();
    // Surface both APIs to the test the first time we render.
    const surfaced = (typeof window !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__persistProbe) as boolean | undefined;
    if (!surfaced) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__persistProbe = true;
      onReady({
        setSettings: (s) => setSettings(s),
        updateTheme: () => update("themeMode", "dark"),
      });
    }
    return <div data-testid="theme">{settings.themeMode}</div>;
  }

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__persistProbe;
    mocked.mockClear();
  });

  it("setSettings with an equal-by-value but new-by-reference object does NOT re-invoke settings_save", async () => {
    let api: {
      setSettings: (s: typeof DEFAULTS) => void;
      updateTheme: () => void;
    } | null = null;
    render(
      <SettingsProvider>
        <PersistProbe onReady={(a) => (api = a)} />
      </SettingsProvider>,
    );
    // Wait for the on-mount disk-load to settle. Without this the first
    // render's persist call counts against the mock and obscures the
    // dedup assertion.
    await act(async () => {
      await Promise.resolve();
    });
    expect(api).not.toBeNull();
    // Clear save-related calls accumulated from mount (initial settings
    // load + first persist tick).
    mocked.mockClear();

    // Apply a real value change first so the persist effect arms with a
    // known JSON snapshot.
    await act(async () => {
      api!.updateTheme();
      await Promise.resolve();
    });
    const saveCallsAfterRealChange = mocked.mock.calls.filter(
      ([cmd]) => cmd === "settings_save",
    ).length;
    expect(saveCallsAfterRealChange).toBeGreaterThan(0);

    // Now push an equal-by-VALUE settings object with a fresh reference —
    // the cross-window listener does this every time another window
    // (or this window's own self-emit) writes the same JSON to disk.
    mocked.mockClear();
    await act(async () => {
      api!.setSettings({ ...DEFAULTS, themeMode: "dark" });
      await Promise.resolve();
    });
    const saveCallsAfterEqualPush = mocked.mock.calls.filter(
      ([cmd]) => cmd === "settings_save",
    ).length;
    expect(saveCallsAfterEqualPush).toBe(0);
  });

  it("setSettings with a real value change DOES invoke settings_save", async () => {
    let api: {
      setSettings: (s: typeof DEFAULTS) => void;
      updateTheme: () => void;
    } | null = null;
    render(
      <SettingsProvider>
        <PersistProbe onReady={(a) => (api = a)} />
      </SettingsProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    mocked.mockClear();

    await act(async () => {
      api!.setSettings({ ...DEFAULTS, themeMode: "light" });
      await Promise.resolve();
    });
    const saveCalls = mocked.mock.calls.filter(
      ([cmd]) => cmd === "settings_save",
    ).length;
    expect(saveCalls).toBeGreaterThan(0);
  });
});
