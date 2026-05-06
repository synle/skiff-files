import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  DEFAULTS,
  SettingsProvider,
  loadSettings,
  saveSettings,
  useSettings,
} from "./settings";

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
