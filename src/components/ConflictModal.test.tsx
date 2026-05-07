import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import ConflictModal from "./ConflictModal";
import { SettingsProvider } from "../state/settings";

const theme = createTheme();
const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

beforeEach(() => {
  mockedInvoke.mockClear();
  mockedListen.mockClear();
});

/** Render and capture the listener callback so tests can fire fake
 *  conflict events. The default mock returns a no-op unlisten; we wrap
 *  it to also stash the handler. */
function renderAndCapture(): {
  fire: (payload: Record<string, unknown>) => void;
} {
  let handler:
    | ((event: { payload: Record<string, unknown> }) => void)
    | null = null;
  mockedListen.mockImplementationOnce(async (eventName, cb) => {
    if (eventName === "sync:conflict") {
      handler = cb as typeof handler;
    }
    return () => {};
  });
  render(
    <ThemeProvider theme={theme}>
      <SettingsProvider>
        <ConflictModal />
      </SettingsProvider>
    </ThemeProvider>,
  );
  return {
    fire: (payload) => {
      // The listener mounts inside an async useEffect — block until it
      // registers the callback, then fire.
      const tick = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 0));
      void (async () => {
        // Drain microtasks until the handler is set.
        for (let i = 0; i < 20 && !handler; i++) {
          await tick();
        }
        if (handler) {
          act(() => {
            handler!({ payload });
          });
        }
      })();
    },
  };
}

const samplePayload = {
  jobId: "job-1",
  conflictId: "c-1",
  src: "/src/a.txt",
  dest: "/dest/a.txt",
  srcSize: 1024,
  destSize: 1024,
  srcMtime: 1700000000,
  destMtime: 1700000000,
};

describe("ConflictModal", () => {
  it("does not render until a conflict event fires", () => {
    renderAndCapture();
    expect(
      screen.queryByText(/Destination file already exists/),
    ).not.toBeInTheDocument();
  });

  it("renders the dest path + Same-size + Same-date badges when applicable", async () => {
    const { fire } = renderAndCapture();
    fire(samplePayload);
    await waitFor(() => {
      expect(
        screen.getByText("Destination file already exists"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("/dest/a.txt")).toBeInTheDocument();
    expect(screen.getByText("Same size")).toBeInTheDocument();
    expect(screen.getByText("Same date")).toBeInTheDocument();
  });

  it("Overwrite invokes sync_resolve_conflict with overwrite", async () => {
    const { fire } = renderAndCapture();
    fire(samplePayload);
    await waitFor(() =>
      expect(screen.getByText("Overwrite")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Overwrite"));
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("sync_resolve_conflict", {
        jobId: "job-1",
        conflictId: "c-1",
        decision: "overwrite",
      });
    });
  });

  it("Skip / Keep both / Cancel job each map to the right decision", async () => {
    const { fire } = renderAndCapture();
    fire(samplePayload);
    await waitFor(() =>
      expect(screen.getByText("Skip")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Skip"));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "sync_resolve_conflict",
        expect.objectContaining({ decision: "skip" }),
      ),
    );

    // Fire a second event to test KeepBoth.
    fire({ ...samplePayload, conflictId: "c-2" });
    await waitFor(() =>
      expect(screen.getByText("Keep both")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Keep both"));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "sync_resolve_conflict",
        expect.objectContaining({ decision: "keepBoth" }),
      ),
    );

    fire({ ...samplePayload, conflictId: "c-3" });
    await waitFor(() =>
      expect(screen.getByText("Cancel job")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Cancel job"));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "sync_resolve_conflict",
        expect.objectContaining({ decision: "cancelJob" }),
      ),
    );
  });

  it("Apply-to-all buttons appear when more than one conflict is queued", async () => {
    const { fire } = renderAndCapture();
    fire({ ...samplePayload, conflictId: "c-1" });
    fire({ ...samplePayload, conflictId: "c-2", dest: "/dest/b.txt" });
    await waitFor(() =>
      expect(screen.getByText("Overwrite all")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Overwrite all"));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "sync_resolve_conflict",
        expect.objectContaining({ decision: "overwriteAll" }),
      ),
    );
  });

  it("Apply-to-all row is hidden for single-conflict prompts", async () => {
    const { fire } = renderAndCapture();
    fire(samplePayload);
    await waitFor(() =>
      expect(screen.getByText("Overwrite")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Overwrite all")).not.toBeInTheDocument();
  });

  it("queues additional conflicts and shows them in turn", async () => {
    const { fire } = renderAndCapture();
    fire({ ...samplePayload, conflictId: "c-1" });
    fire({ ...samplePayload, conflictId: "c-2", dest: "/dest/b.txt" });
    await waitFor(() =>
      expect(screen.getByText("/dest/a.txt")).toBeInTheDocument(),
    );
    // Queue length indicator visible.
    expect(screen.getByText(/1 more conflict/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip"));
    await waitFor(() =>
      expect(screen.getByText("/dest/b.txt")).toBeInTheDocument(),
    );
  });
});
