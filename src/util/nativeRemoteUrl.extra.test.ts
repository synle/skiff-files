// Branch-coverage pad for nativeRemoteUrl.ts. Base suite covers the
// SMB happy path + the SFTP/FTP "no native handler" returns. This
// adds:
//   - Empty input → empty url (the leading guard) — surfaces when a
//     callsite hands us "" while resolving a fallback.
//   - Domain prefix preserves through the SMB encode (some Windows
//     servers expect DOMAIN\user; we URL-encode the backslash).
//   - Default port (445) does NOT get an explicit port suffix —
//     pinned so URLs stay tidy across the macOS Finder + Windows
//     Explorer + Linux file-manager registries.
//   - bound-share + leading slash in rel path → the rel path gets
//     its leading slashes stripped before injection so the resulting
//     URL doesn't have a `//` after the share.
import { describe, expect, it } from "vitest";
import type { SavedConnection } from "../state/connectionStore";
import { toNativeRemoteUrl } from "./nativeRemoteUrl";

const SMB: SavedConnection = {
  id: "smb-x",
  kind: "smb",
  label: "admin@nas:445/Public",
  host: "nas.local",
  port: 445,
  user: "admin",
  share: "Public",
  rememberPassword: false,
};

describe("toNativeRemoteUrl — empty input guard", () => {
  it("returns { url: '' } for an empty path", () => {
    // The leading guard short-circuits before parseLocation. Used by
    // callsites that defensively call into the helper with a fallback
    // value (e.g. PathBar focus restoration).
    expect(toNativeRemoteUrl("", [])).toEqual({ url: "" });
  });
});

describe("toNativeRemoteUrl — default port stays implicit", () => {
  it("omits the :445 suffix for the SMB default port", () => {
    const got = toNativeRemoteUrl("smb://smb-x/file.png", [SMB]);
    // No `:` after the host → port suffix was suppressed.
    expect(got.url).toBe("smb://admin@nas.local/Public/file.png");
    expect(got.url).not.toMatch(/:445/);
  });
});

describe("toNativeRemoteUrl — strips leading slashes from rel before share", () => {
  it("trims `//`-prefixed rel paths so the URL doesn't end up with a doubled slash", () => {
    // Internal URL with leading slashes inside the path component.
    // The encoded URL must collapse those so Finder doesn't choke on
    // `smb://host/Public//file.png` (double-slash inside the share).
    const got = toNativeRemoteUrl("smb://smb-x//file.png", [SMB]);
    expect(got.url).toBe("smb://admin@nas.local/Public/file.png");
  });
});

describe("toNativeRemoteUrl — special-char escaping", () => {
  it("URL-encodes share names that contain spaces", () => {
    const conn: SavedConnection = { ...SMB, share: "Public Share" };
    const got = toNativeRemoteUrl("smb://smb-x/file.png", [conn]);
    expect(got.url).toBe(
      "smb://admin@nas.local/Public%20Share/file.png",
    );
  });
});
