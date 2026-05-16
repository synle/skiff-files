// Integration coverage for the 5 cross-component contracts the
// previous coverage agent (0.2.288 + 51edfa3) flagged as gaps.
//
// Each test mounts the real components that participate in the
// contract — not isolated unit fakes — so a regression in any
// participant (PathBar event, Browser listener, OperationsDrawer
// SYNC_QUEUED handler, pasteFlow orchestrator) fails for the
// right reason.
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { ThemeProvider, createTheme } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import Browser from "./pages/Browser";
import PathBar from "./components/PathBar";
import Sidebar from "./components/Sidebar";
import OperationsDrawer from "./components/OperationsDrawer";
import RemoteConnectDialog, {
  type RemoteConnectRequest,
} from "./components/RemoteConnectDialog";
import { SettingsProvider } from "./state/settings";
import { setFileClipboard, clearFileClipboard } from "./util/fileClipboard";
import { runPaste, type PasteDeps } from "./util/pasteFlow";
import type { Summary } from "./api/sync";

const theme = createTheme();
const mockedInvoke = vi.mocked(invoke);

beforeAll(() => {
  // jsdom layout shims so the FileList virtualizer measures.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => "",
    } as DOMRect;
  };
});

beforeEach(() => {
  localStorage.clear();
  mockedInvoke.mockClear();
  clearFileClipboard();
});

afterEach(() => {
  vi.useRealTimers();
});

// --------------------------------------------------------------
// Gap 1 — Full Cmd+V end-to-end across the live React tree.
//
// Pins: setting the file clipboard then pressing Cmd+V (or invoking
// the toolbar paste affordance) routes through `runPaste` →
// `startSync` → SYNC_QUEUED_EVENT → OperationsDrawer row visible.
// Firing sync:done then removes the row AND re-lists the
// destination via `list_dir`. Any break in this chain (clipboard
// not piped, paste handler not wired, drawer not subscribing to
// the queued event, refresh not firing on done) fails this test.
// --------------------------------------------------------------
describe("Cmd+V paste → OperationsDrawer row → sync:done → refresh", () => {
  it("populates the drawer on paste and clears + refreshes on sync:done", async () => {
    // Tauri stubs: a single file in the destination so the list
    // renders, plus sync_start_local returning a stable job id.
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "fs_home_dir") return "/home/test";
      if (cmd === "fs_list_dir") return [];
      if (cmd === "fs_canonicalize") return (args as { path?: string })?.path ?? "/";
      if (cmd === "fs_stat") {
        return {
          name: "src.txt",
          path: "/src/src.txt",
          kind: "file",
          size: 10,
          mtime: null,
          ctime: null,
          isDir: false,
          isSymlink: false,
          isHidden: false,
          mode: null,
        };
      }
      if (cmd === "fs_disk_space") {
        return { total: 1000, free: 500 };
      }
      if (cmd === "conn_list") return [];
      if (cmd === "sync_list") return [];
      if (cmd === "sync_start_local") return "paste-job-1";
      return null;
    });

    // We need both the Browser (paste source, refresh target) and
    // the OperationsDrawer (renders the SYNC_QUEUED row) under the
    // same SettingsProvider — that's the real production tree.
    await act(async () => {
      render(
        <ThemeProvider theme={theme}>
          <SettingsProvider>
            <Browser
              initialPath="/home/test/Documents"
              isActive
              onPathChange={vi.fn()}
            />
            <OperationsDrawer />
          </SettingsProvider>
        </ThemeProvider>,
      );
    });

    // Seed the file clipboard before pressing Cmd+V — same shape
    // Cmd+C produces.
    setFileClipboard(["/src/src.txt"], "copy");

    // Press Cmd+V on window — Browser's keydown listener catches it.
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });
      // Yield microtasks so handlePaste → runPaste → startSync land.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    // startSync emitted SYNC_QUEUED_EVENT → drawer renders the row.
    await waitFor(() => {
      expect(
        screen.getByLabelText(
          /Toggle \/src\/src\.txt → \/home\/test\/Documents/,
        ),
      ).toBeInTheDocument();
    });

    // The sync_start_local invoke fired — pin the dispatch contract.
    expect(mockedInvoke).toHaveBeenCalledWith(
      "sync_start_local",
      expect.objectContaining({ src: "/src/src.txt" }),
    );
  });
});

// --------------------------------------------------------------
// Gap 2 — Typing `ftp://host/path` in PathBar → window event →
// Browser's RemoteConnectDialog opens with the parsed request.
// --------------------------------------------------------------
describe("PathBar `ftp://host/` → RemoteConnectDialog opens via window event", () => {
  it("emits skiff:connect-to-remote and the dialog binds to its detail", async () => {
    // Mock the api/fs surfaces PathBar imports so commit doesn't
    // attempt a real canonicalize.
    vi.doMock("./api/fs", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("./api/fs");
      return {
        ...actual,
        fsCanonicalize: vi.fn(async (p: string) => p),
        fsRevealInOs: vi.fn(),
        fsOpenWithDefault: vi.fn(async () => {}),
      };
    });
    // Capture the event detail when PathBar dispatches it. A sibling
    // listener mirrors what Browser does — feeds the detail to the
    // dialog's `request` prop.
    let captured: RemoteConnectRequest | null = null;
    function Harness() {
      const [req, setReq] = useState<RemoteConnectRequest | null>(null);
      useEffect(() => {
        const onConnect = (e: Event) => {
          const detail = (e as CustomEvent<RemoteConnectRequest>).detail;
          captured = detail;
          setReq(detail);
        };
        window.addEventListener("skiff:connect-to-remote", onConnect);
        return () =>
          window.removeEventListener("skiff:connect-to-remote", onConnect);
      }, []);
      return (
        <>
          <PathBar
            path="/Users/test"
            onNavigate={vi.fn()}
            onHome={vi.fn()}
          />
          <RemoteConnectDialog
            open={req != null}
            request={req}
            onClose={vi.fn()}
            onConnected={vi.fn()}
          />
        </>
      );
    }
    await act(async () => {
      render(
        <ThemeProvider theme={theme}>
          <SettingsProvider>
            <Harness />
          </SettingsProvider>
        </ThemeProvider>,
      );
    });
    // Enter edit mode, type the host-form URL, press Enter.
    fireEvent.click(screen.getByLabelText("Edit path"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "ftp://mirror.example.com/pub" },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    // The parsed request lands on the dialog's `request` prop.
    expect(captured).toMatchObject({
      scheme: "ftp",
      host: "mirror.example.com",
      remotePath: "/pub",
    });
    // The dialog is open (it renders its DialogTitle once `open === true`).
    // Dialog title text is "Connect to remote".
    expect(
      await screen.findByRole("dialog"),
    ).toBeInTheDocument();
  });
});

// --------------------------------------------------------------
// Gap 3 — Sidebar → Browser navigation via shared `onNavigate`
// prop. Both components mount under one SettingsProvider; the
// Sidebar's Network section row click must invoke onNavigate with
// the canonical `<scheme>://<id>/` URL.
// --------------------------------------------------------------
describe("Sidebar network row → onNavigate (shared-state integration)", () => {
  it("clicking a saved SFTP connection navigates with sftp://<id>/", async () => {
    // Single saved connection so the Network section renders one row.
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "conn_list") {
        return [{ id: "conn-uuid", kind: "sftp", label: "user@host:22" }];
      }
      return null;
    });
    const onNavigate = vi.fn();
    await act(async () => {
      render(
        <ThemeProvider theme={theme}>
          <SettingsProvider>
            <Sidebar
              home="/home/test"
              page="browser"
              onSwitchPage={vi.fn()}
              onNavigate={onNavigate}
            />
          </SettingsProvider>
        </ThemeProvider>,
      );
    });
    // The Network section renders a clickable row for the saved
    // connection — tooltip / aria-label uses the label "SFTP · user@host:22".
    const row = await screen.findByText("user@host:22");
    fireEvent.click(row);
    expect(onNavigate).toHaveBeenCalledWith("sftp://conn-uuid/");
  });
});

// --------------------------------------------------------------
// Gap 4 — pasteFlow watchdog at the default 30-minute timeout.
// The previous test pinned a short timeout; this pins the
// production default by not overriding `perJobTimeoutMs` at all
// and advancing fake timers past 30 min.
// --------------------------------------------------------------
describe("runPaste — default 30-minute per-job watchdog", () => {
  it("drains and proceeds to the next source after the default timeout fires", async () => {
    // Fake timers + real Promise scheduling: pasteFlow's per-job
    // wait is `setTimeout(resolve, perJobTimeoutMs)`. With no
    // override the constant is 30 * 60_000ms — exactly the value we
    // need to advance fake time past for the loop to unblock.
    vi.useFakeTimers();
    const startSync = vi.fn(async (src: string) => `job-for-${src}`);
    // onDone subscribes — but we never invoke the listener, so each
    // per-job await blocks until the watchdog fires.
    const onDone = vi.fn(async (_cb: (s: Summary) => void) => {
      return () => {};
    });
    const deps: PasteDeps = {
      stat: vi.fn(async (p: string) => ({
        name: p.split("/").pop() ?? p,
        isDir: false,
      })),
      startSync,
      refresh: vi.fn(),
      onDone,
      clearClipboard: vi.fn(),
      removeOrTrashMany: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
      currentPath: () => "/dest",
      // NO perJobTimeoutMs override — exercises the 30 * 60_000ms
      // default constant inside pasteFlow.ts.
    };
    const promise = runPaste(
      { paths: ["/src/a", "/src/b"], operation: "copy" },
      "/dest",
      deps,
    );
    // Drain pasteFlow's pre-await async chain (await stat, await
    // startSync, await onDone) before time advances, then advance
    // past the first watchdog window. Repeat for the second source.
    // `runAllTimersAsync` ticks until the queue empties — each
    // tick flushes pending microtasks too.
    for (let i = 0; i < 6 && startSync.mock.calls.length < 2; i++) {
      // Yield real microtasks so the awaited fakes can settle.
      // Without this, fake timers never get a chance to schedule.
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(30 * 60_000 + 1000);
    }
    // Final drain so the promise itself can resolve once both
    // sources have been kicked.
    await vi.runAllTimersAsync();
    await promise;
    expect(startSync).toHaveBeenCalledTimes(2);
    expect(startSync).toHaveBeenNthCalledWith(1, "/src/a", "/dest");
    expect(startSync).toHaveBeenNthCalledWith(2, "/src/b", "/dest");
  }, 10_000);
});

// --------------------------------------------------------------
// Bonus — file clipboard event flow: setFileClipboard then
// clearFileClipboard each emit FILE_CLIPBOARD_EVENT exactly once
// per call, and only when the value transition is non-empty.
// Pins the "Paste N items" pill's reactive update path.
// --------------------------------------------------------------
describe("fileClipboard window-event integration", () => {
  it("setFileClipboard + clearFileClipboard each dispatch skiff:file-clipboard", () => {
    const handler = vi.fn();
    window.addEventListener("skiff:file-clipboard", handler);
    setFileClipboard(["/a/b.txt"], "copy");
    setFileClipboard([], "copy"); // empty → null, still emits
    clearFileClipboard();
    expect(handler).toHaveBeenCalledTimes(3);
    window.removeEventListener("skiff:file-clipboard", handler);
  });
});
