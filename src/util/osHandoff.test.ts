// Pins the OS-handoff contract: every path the UI hands off to the
// OS (open-with-default, reveal-in-file-manager) MUST be translated
// from the internal `<scheme>://<uuid>/` form to the native form
// first. The 0.2.305 bug was a `fsOpenWithDefault(e.path)` call that
// forwarded the UUID URL verbatim; macOS Finder then tried to
// resolve the UUID as a hostname and failed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsOpenWithDefault = vi.fn(async (_p: string) => {});
const fsRevealInOs = vi.fn(async (_p: string) => {});

vi.mock("../api/fs", () => ({
  fsOpenWithDefault: (p: string) => fsOpenWithDefault(p),
  fsRevealInOs: (p: string) => fsRevealInOs(p),
}));

import type { SavedConnection } from "../state/connectionStore";
import { osOpen, osReveal } from "./osHandoff";

const SMB: SavedConnection = {
  id: "smb-uuid",
  kind: "smb",
  label: "admin@192.168.1.1:445/G",
  host: "192.168.1.1",
  port: 445,
  user: "admin",
  share: "G",
  rememberPassword: false,
};

const SFTP: SavedConnection = {
  id: "sftp-uuid",
  kind: "sftp",
  label: "syle@example.com:22",
  host: "example.com",
  port: 22,
  user: "syle",
  rememberPassword: false,
};

describe("osOpen — internal UUID URL is rewritten to native form", () => {
  beforeEach(() => {
    fsOpenWithDefault.mockClear();
    fsRevealInOs.mockClear();
  });

  it("SMB: smb://<uuid>/file.png → smb://user@host:port/share/file.png", async () => {
    await osOpen("smb://smb-uuid/file.png", [SMB]);
    expect(fsOpenWithDefault).toHaveBeenCalledWith(
      "smb://admin@192.168.1.1/G/file.png",
    );
    // The UUID form must never reach the OS call.
    const arg = fsOpenWithDefault.mock.calls[0]?.[0] ?? "";
    expect(arg).not.toContain("smb-uuid");
  });

  it("local path passes through unchanged", async () => {
    await osOpen("/Users/syle/file.txt", []);
    expect(fsOpenWithDefault).toHaveBeenCalledWith("/Users/syle/file.txt");
  });

  it("SFTP routes to onError with the no-native-handler reason", async () => {
    const onError = vi.fn();
    await osOpen("sftp://sftp-uuid/home/file.txt", [SFTP], onError);
    expect(fsOpenWithDefault).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/sftp/i);
  });

  it("unknown connection id reports an error and skips the IPC call", async () => {
    const onError = vi.fn();
    await osOpen("smb://unknown-uuid/a.png", [], onError);
    expect(fsOpenWithDefault).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("osReveal — internal UUID URL is rewritten to native form", () => {
  beforeEach(() => {
    fsOpenWithDefault.mockClear();
    fsRevealInOs.mockClear();
  });

  it("SMB: rewrites the URL before fs_reveal_in_os", async () => {
    await osReveal("smb://smb-uuid/sub/file.png", [SMB]);
    expect(fsRevealInOs).toHaveBeenCalledWith(
      "smb://admin@192.168.1.1/G/sub/file.png",
    );
  });

  it("SFTP routes to onError instead of an IPC call", async () => {
    const onError = vi.fn();
    await osReveal("sftp://sftp-uuid/file", [SFTP], onError);
    expect(fsRevealInOs).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("local path passes through unchanged", async () => {
    await osReveal("/Users/syle/file.txt", []);
    expect(fsRevealInOs).toHaveBeenCalledWith("/Users/syle/file.txt");
  });
});
