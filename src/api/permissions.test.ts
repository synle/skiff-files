// Smoke tests for the macOS Full Disk Access (TCC) bindings. The
// Rust side has its own probe-algorithm tests; these pin the command
// names + argument shape so a rename on either side trips here before
// the auto-prompt in App.tsx silently stops firing.
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  macosCheckFullDiskAccess,
  macosOpenFullDiskAccessSettings,
} from "./permissions";

const mockedInvoke = vi.mocked(invoke);

describe("macOS Full Disk Access bindings", () => {
  it("macosCheckFullDiskAccess routes to `macos_check_full_disk_access`", async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const got = await macosCheckFullDiskAccess();
    expect(got).toBe(true);
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      "macos_check_full_disk_access",
    );
  });

  it("returns the Rust verdict verbatim (true / false)", async () => {
    mockedInvoke.mockResolvedValueOnce(false);
    expect(await macosCheckFullDiskAccess()).toBe(false);
    mockedInvoke.mockResolvedValueOnce(true);
    expect(await macosCheckFullDiskAccess()).toBe(true);
  });

  it("macosOpenFullDiskAccessSettings routes to `macos_open_full_disk_access_settings`", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await macosOpenFullDiskAccessSettings();
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      "macos_open_full_disk_access_settings",
    );
  });

  it("open-settings rejection surfaces to the caller", async () => {
    mockedInvoke.mockRejectedValueOnce(
      new Error("Full Disk Access is a macOS-only privacy setting"),
    );
    await expect(macosOpenFullDiskAccessSettings()).rejects.toThrow(
      /macOS-only/,
    );
  });
});
