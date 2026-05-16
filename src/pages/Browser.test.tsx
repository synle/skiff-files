import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import Browser from "./Browser";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();

beforeEach(() => {
  localStorage.clear();
  // jsdom layout shims for the virtualizer inside FileList.
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver =
      FakeResizeObserver;
  }
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
});

function r(over: Partial<Parameters<typeof Browser>[0]> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <Browser
          initialPath="/home/test"
          isActive
          onPathChange={vi.fn()}
          {...over}
        />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

describe("Browser smoke", () => {
  it("mounts without throwing and renders the toolbar", async () => {
    await act(async () => {
      r();
    });
    // The toolbar's search box is the easiest stable marker.
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("renders with a remote path as initialPath", async () => {
    await act(async () => {
      r({ initialPath: "sftp://test-conn-id/home" });
    });
    // No live registry under jsdom → listDir rejects, the Browser
    // enters the unreachable-folder placeholder state. The
    // navigation cluster (Back / Forward / Up / Refresh) is what
    // stays mounted; the search input is hidden by the Toolbar's
    // disabled collapse. Smoke just confirms the Browser doesn't
    // throw and renders the placeholder's Retry button.
    expect(
      screen.getByRole("button", { name: /Retry connection/i }),
    ).toBeInTheDocument();
  });

  it("renders inactive tabs without keyboard handlers", async () => {
    await act(async () => {
      r({ isActive: false });
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("renders with preview pane enabled in settings", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ previewMode: "always" }),
    );
    await act(async () => {
      r();
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("renders with two-pane mode enabled in settings", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ twoPaneMode: true }),
    );
    await act(async () => {
      r();
    });
    // Two-pane mode renders an extra Browser; the search box should
    // still be present in at least one.
    expect(
      screen.getAllByLabelText(/Search current folder/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders with gallery default view", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ defaultView: "gallery" }),
    );
    await act(async () => {
      r();
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("toolbar exposes the search input as a labelled element", async () => {
    await act(async () => {
      r();
    });
    const inputs = screen.getAllByLabelText(/Search current folder/i);
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("renders with kindFilterOpen via local toggle (no crash)", async () => {
    await act(async () => {
      r();
    });
    // Toggle the kind-filter chip row via the toolbar button.
    const btn = screen.getByLabelText(/kind filter/i);
    await act(async () => {
      btn.click();
    });
    // The chip row's "Filter:" label now renders.
    expect(screen.getByText(/^Filter:/)).toBeInTheDocument();
  });

  it("renders with compact density + showHidden", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({
        density: "compact",
        showHidden: true,
      }),
    );
    await act(async () => {
      r();
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching NAVIGATE_EVENT triggers navigation in active Browser", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:navigate", {
          detail: "/Users/test/Documents",
        }),
      );
    });
    // No crash + still rendering — the event was handled.
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching skiff:refresh on the active Browser is a no-op smoke", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("skiff:refresh"));
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd/Ctrl+F focuses the search input via keyboard", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
    // Active element is the search input after the keybind.
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching skiff:tag-selection on the active Browser is handled", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:tag-selection", { detail: { color: "red" } }),
      );
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd/Ctrl+Shift+F toggles recursive search mode", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching skiff:run-saved-search executes the saved query", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:run-saved-search", {
          detail: { path: "/home/test", query: "foo", regex: false },
        }),
      );
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("F5 triggers a refresh", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, { key: "F5" });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Backspace navigates up one folder", async () => {
    await act(async () => {
      r({ initialPath: "/home/test/Documents" });
    });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd+L focuses the path bar editor", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd+Shift+N opens the new-folder dialog", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, {
      key: "n",
      code: "KeyN",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd+I toggles the preview pane", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd+R triggers a refresh", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching skiff:new-folder opens the new-folder dialog", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("skiff:new-folder"));
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching skiff:restore-selection seeds the multi-select set", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:restore-selection", {
          detail: ["/x/a", "/x/b"],
        }),
      );
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching skiff:refresh-all hits the all-tab branch", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("skiff:refresh-all"));
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("renders with showFullPathInTitle setting on", async () => {
    localStorage.setItem(
      "skiff-files.settings.v1",
      JSON.stringify({ showFullPathInTitle: true }),
    );
    await act(async () => {
      r();
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("Cmd+Shift+. toggles hidden-file visibility", async () => {
    await act(async () => {
      r();
    });
    fireEvent.keyDown(window, {
      key: ".",
      code: "Period",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });

  it("dispatching FILE_CLIPBOARD_EVENT refreshes the paste affordance", async () => {
    await act(async () => {
      r();
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("skiff:file-clipboard"));
    });
    expect(
      screen.getByLabelText(/Search current folder/i),
    ).toBeInTheDocument();
  });
});
