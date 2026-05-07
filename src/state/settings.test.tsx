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
