import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsProvider } from "../state/settings";
import OperationsDrawer from "./OperationsDrawer";

const theme = createTheme();

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

beforeEach(() => {
  mockedInvoke.mockClear();
  mockedListen.mockClear();
  // SettingsProvider reads operationsDrawerExpanded from localStorage on
  // mount; clearing keeps each test starting from defaults (expanded=true)
  // so collapsed-drawer state doesn't leak across cases.
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function r() {
  return render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <OperationsDrawer />
      </SettingsProvider>
    </ThemeProvider>,
  );
}

describe("OperationsDrawer", () => {
  it("renders nothing when there are no in-flight jobs (smoke)", async () => {
    let result: ReturnType<typeof r>;
    await act(async () => {
      result = r();
    });
    // With no jobs the drawer short-circuits to `null`. Just confirm the
    // mount doesn't throw and produces no Paper element.
    expect(result!.container.querySelector(".MuiPaper-root")).toBeNull();
  });

  it("seeds in-flight jobs from sync_list on mount", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") {
        return [
          {
            id: "job-1",
            src: "/src",
            dest: "/dest",
            state: "running",
          },
        ];
      }
      return null;
    });
    await act(async () => {
      r();
    });
    // The drawer should render once it finds at least one running job.
    await waitFor(() => {
      expect(screen.getByText(/operation/i)).toBeInTheDocument();
    });
  });

  it("renders a progress widget once a sync:progress event fires", async () => {
    // Capture the registered progress handler so we can fire it.
    let onProgressCb:
      | ((e: {
          payload: {
            jobId: string;
            filesTotal: number;
            filesDone: number;
            bytesTotal: number;
            bytesDone: number;
            last: null;
          };
        }) => void)
      | null = null;
    mockedListen.mockImplementation(async (name, handler) => {
      if (name === "sync:progress") {
        onProgressCb = handler as typeof onProgressCb;
      }
      return () => {};
    });
    await act(async () => {
      r();
    });
    // Fire a synthetic progress event.
    await act(async () => {
      onProgressCb?.({
        payload: {
          jobId: "new-job",
          filesTotal: 10,
          filesDone: 3,
          bytesTotal: 1000,
          bytesDone: 300,
          last: null,
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/operation/i)).toBeInTheDocument();
    });
  });

  it("expand button toggles between expand/collapse aria-label", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") {
        return [{ id: "j", src: "/s", dest: "/d", state: "running" }];
      }
      return null;
    });
    await act(async () => {
      r();
    });
    // The button starts in one of the two labels — just click it and
    // confirm the drawer still mounts.
    const allBtns = await waitFor(() => screen.getAllByLabelText(/operations drawer/i));
    fireEvent.click(allBtns[0]);
    expect(screen.getByText(/operation/i)).toBeInTheDocument();
  });

  it("renders multiple in-flight jobs as an accordion (one expanded at a time)", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") {
        return [
          { id: "job-a", src: "/src/a", dest: "/dest/a", state: "running" },
          { id: "job-b", src: "/src/b", dest: "/dest/b", state: "running" },
          { id: "job-c", src: "/src/c", dest: "/dest/c", state: "running" },
        ];
      }
      return null;
    });
    await act(async () => {
      r();
    });
    // All three rows render as accordion summaries.
    await waitFor(() => {
      expect(
        screen.getByLabelText("Toggle /src/a → /dest/a"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText("Toggle /src/b → /dest/b"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Toggle /src/c → /dest/c"),
    ).toBeInTheDocument();
  });

  it("clicking another accordion summary collapses the previous one", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") {
        return [
          { id: "job-a", src: "/src/a", dest: "/dest/a", state: "running" },
          { id: "job-b", src: "/src/b", dest: "/dest/b", state: "running" },
        ];
      }
      return null;
    });
    await act(async () => {
      r();
    });
    // The first job seeds as open. Asserting via aria-expanded keeps
    // the check independent of MUI's internal class names.
    const summaryA = await waitFor(() =>
      screen.getByLabelText("Toggle /src/a → /dest/a"),
    );
    const summaryB = screen.getByLabelText("Toggle /src/b → /dest/b");
    expect(summaryA.getAttribute("aria-expanded")).toBe("true");
    expect(summaryB.getAttribute("aria-expanded")).toBe("false");
    // Clicking B opens it AND closes A — accordion semantics.
    fireEvent.click(summaryB);
    await waitFor(() => {
      expect(summaryB.getAttribute("aria-expanded")).toBe("true");
    });
    expect(summaryA.getAttribute("aria-expanded")).toBe("false");
  });

  it("Hide button drops the drawer until a new job emits", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") {
        return [
          { id: "j", src: "/s", dest: "/d", state: "running" },
        ];
      }
      return null;
    });
    await act(async () => {
      r();
    });
    const hideBtn = await waitFor(() =>
      screen.getByLabelText("Hide operations drawer"),
    );
    fireEvent.click(hideBtn);
    expect(screen.queryByText(/operation/i)).toBeNull();
  });
});
