import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

// The global test setup mocks @tauri-apps/api/core but doesn't expose a
// `Channel` class. drag.ts uses `new Channel<…>()` and attaches an
// onmessage handler the test wants to fire. Re-mock the module here with
// a minimal Channel stub on top of the existing invoke mock.
vi.mock("@tauri-apps/api/core", async () => {
  const actual =
    await vi.importActual<typeof import("@tauri-apps/api/core")>(
      "@tauri-apps/api/core",
    );
  class FakeChannel<T> {
    onmessage?: (msg: T) => void;
  }
  return {
    ...actual,
    invoke: vi.fn(),
    Channel: FakeChannel,
  };
});

import { startNativeDrag } from "./drag";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
});

describe("startNativeDrag", () => {
  it("is a no-op when files is empty (no invoke, no onEnd)", async () => {
    const onEnd = vi.fn();
    await startNativeDrag([], { onEnd });
    expect(mocked).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("invokes the drag plugin with the supplied paths + default copy mode", async () => {
    mocked.mockResolvedValueOnce(undefined);
    await startNativeDrag(["/a", "/b"]);
    expect(mocked).toHaveBeenCalledWith(
      "plugin:drag|start_drag",
      expect.objectContaining({
        item: ["/a", "/b"],
        options: { mode: "copy" },
      }),
    );
  });

  it("forwards the requested drag mode", async () => {
    mocked.mockResolvedValueOnce(undefined);
    await startNativeDrag(["/x"], { mode: "move" });
    expect(mocked).toHaveBeenLastCalledWith(
      "plugin:drag|start_drag",
      expect.objectContaining({ options: { mode: "move" } }),
    );
  });

  it("falls back to calling onEnd when the plugin throws (test/browser mode)", async () => {
    mocked.mockRejectedValueOnce(new Error("plugin not registered"));
    const onEnd = vi.fn();
    await startNativeDrag(["/a"], { onEnd });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("survives a plugin error even without onEnd (silent fallback)", async () => {
    mocked.mockRejectedValueOnce(new Error("no plugin"));
    await expect(startNativeDrag(["/a"])).resolves.toBeUndefined();
  });

  it("registered onEnd fires exactly once even if the channel emits twice", async () => {
    // Capture the Channel object the wrapper attaches its onmessage to.
    type CapturedChannel = { onmessage?: (msg: unknown) => void };
    let capturedOnEvent: CapturedChannel | null = null;
    mocked.mockImplementationOnce(async (_cmd, args) => {
      capturedOnEvent = (args as { onEvent: CapturedChannel }).onEvent;
      return undefined;
    });
    const onEnd = vi.fn();
    await startNativeDrag(["/a"], { onEnd });
    // Simulate the plugin emitting twice (the wrapper guards against
    // double-fire defensively).
    (capturedOnEvent as CapturedChannel | null)?.onmessage?.({
      result: "Dropped",
      cursorPos: { x: 0, y: 0 },
    });
    (capturedOnEvent as CapturedChannel | null)?.onmessage?.({
      result: "Cancel",
      cursorPos: { x: 0, y: 0 },
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
