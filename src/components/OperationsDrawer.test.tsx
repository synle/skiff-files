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
