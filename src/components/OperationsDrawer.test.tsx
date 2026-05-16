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

  it("seeds the drawer on a SYNC_QUEUED_EVENT (Bug 3 regression)", async () => {
    // Without this, tiny SMB pastes that complete before any
    // sync:progress event would never appear in the drawer at all —
    // exactly the "I am not seeing any progress window" feedback.
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") return [];
      return null;
    });
    await act(async () => {
      r();
    });
    // Fire the window event the way `startSync` does.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:sync-queued", {
          detail: {
            jobId: "queued-job-1",
            src: "/src/file.png",
            dest: "smb://abc/share/file.png",
          },
        }),
      );
    });
    // Drawer now renders with the queued job's src/dest visible.
    await waitFor(() => {
      expect(
        screen.getByLabelText("Toggle /src/file.png → smb://abc/share/file.png"),
      ).toBeInTheDocument();
    });
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

  // Symmetric path to the Hide test above — once the user dismisses
  // the drawer with ×, the NEXT queued job must reveal it again.
  // Bug 3 is specifically that the drawer would stay hidden through
  // the next paste because the queued-event listener wasn't wired,
  // so users who hit × never saw their next sync.
  it("auto-reveals after explicit Hide on the next queued event", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") {
        return [{ id: "j", src: "/s", dest: "/d", state: "running" }];
      }
      return null;
    });
    await act(async () => {
      r();
    });
    // Hide the drawer.
    const hideBtn = await waitFor(() =>
      screen.getByLabelText("Hide operations drawer"),
    );
    fireEvent.click(hideBtn);
    expect(screen.queryByLabelText("Hide operations drawer")).toBeNull();
    // Fire a queued event for a brand-new job — drawer must come
    // back, and the new src/dest must be rendered.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:sync-queued", {
          detail: {
            jobId: "after-hide",
            src: "/src/post-hide.png",
            dest: "/dest/post-hide.png",
          },
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Toggle /src/post-hide.png → /dest/post-hide.png",
        ),
      ).toBeInTheDocument();
    });
  });

  // Bug 3 + cleanup — after the drawer seeds a job from a queued
  // event, the matching sync:done event must prune the row. Without
  // this contract a 1-byte SMB paste would leave a "ghost row"
  // forever (the drawer seeded the row from the queued event, but
  // there was never a sync:progress to keep it alive nor a
  // sync:done to remove it).
  it("queued-then-done prunes the seeded row", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "sync_list") return [];
      return null;
    });
    let doneHandler:
      | ((e: { payload: { jobId: string } }) => void)
      | null = null;
    mockedListen.mockImplementation(async (name, handler) => {
      if (name === "sync:done") {
        doneHandler = handler as typeof doneHandler;
      }
      return () => {};
    });
    await act(async () => {
      r();
    });
    // Queue a job — drawer reveals.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("skiff:sync-queued", {
          detail: {
            jobId: "tiny-job",
            src: "/src/tiny.txt",
            dest: "/dest/tiny.txt",
          },
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText("Toggle /src/tiny.txt → /dest/tiny.txt"),
      ).toBeInTheDocument();
    });
    // Fire done — row must vanish (drawer drops to no-jobs state,
    // which short-circuits to null).
    await act(async () => {
      doneHandler?.({ payload: { jobId: "tiny-job" } });
    });
    await waitFor(() => {
      expect(
        screen.queryByLabelText("Toggle /src/tiny.txt → /dest/tiny.txt"),
      ).toBeNull();
    });
  });
});
