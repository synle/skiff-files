// Branch-coverage pad for connectionStore.ts. The base suite already
// covers happy paths. These tests target the deeply uncovered legacy-
// SMB migration branch (lines 204-223 in connectionStore.ts which
// handles the `server`-field fallback in older saved SMB drafts) and
// the `readLegacyJson` parse-error path (line 166 — malformed JSON
// in localStorage must NOT crash the migration).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ftpToConn,
  migrateLegacyDrafts,
  smbToConn,
  type SavedConnection,
} from "./connectionStore";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("migrateLegacyDrafts — SMB legacy shape", () => {
  it("falls back to the legacy `server` field when `host` is missing", () => {
    // Older versions of the SMB draft serialized the host under
    // `server`. The migration must tolerate this so users on a fresh
    // upgrade don't lose their saved SMB rows.
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([
        {
          id: "legacy-smb-server-field",
          label: "admin@nas",
          server: "nas-old.local",
          port: 445,
          user: "admin",
          share: "Public",
          domain: "WORKGROUP",
        },
      ]),
    );
    const out = migrateLegacyDrafts([]);
    expect(out).toHaveLength(1);
    expect(out[0].host).toBe("nas-old.local");
    expect(out[0].share).toBe("Public");
    expect(out[0].domain).toBe("WORKGROUP");
  });

  it("drops legacy SMB rows that lack both `host` and `server`", () => {
    // Unrecoverable shape — neither field. Migration silently drops
    // the row rather than producing a SavedConnection with an empty
    // host (which would crash dispatch downstream).
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([
        { id: "bad", label: "broken", port: 445, user: "admin" },
      ]),
    );
    const out = migrateLegacyDrafts([]);
    expect(out).toHaveLength(0);
  });

  it("applies the documented defaults when port / user / share / domain are missing", () => {
    // The migration's fallback table: port=445, user="", share="",
    // domain="". Confirms the fallback branches all fire even when
    // the upstream shape is minimal.
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([{ id: "minimal", server: "nas-min", label: "x" }]),
    );
    const out = migrateLegacyDrafts([]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "smb",
      host: "nas-min",
      port: 445,
      user: "",
      share: "",
      domain: "",
      rememberPassword: false,
    });
  });

  it("synthesizes an id when the legacy row had none", () => {
    // The `typeof r.id === "string" ? r.id : 'smb-<ts>-<rand>'`
    // branch — pin the contract that an id is always produced so the
    // dedup-by-id below + the rest of the app's keying-on-id stays
    // sound.
    localStorage.setItem(
      "skiff-files.connections.smb.v1",
      JSON.stringify([{ server: "nas-no-id", label: "x" }]),
    );
    const out = migrateLegacyDrafts([]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^smb-/);
  });
});

describe("migrateLegacyDrafts — malformed JSON guard", () => {
  it("treats invalid JSON in a legacy key as empty (no throw)", () => {
    // readLegacyJson catches the JSON.parse failure and returns [].
    // The migration must complete without throwing so a single
    // corrupt key doesn't lock the user out of every other saved row.
    localStorage.setItem(
      "skiff-files.connections.v1",
      "{ this isn't valid JSON",
    );
    localStorage.setItem(
      "skiff-files.connections.ftp.v1",
      JSON.stringify([
        {
          id: "good-ftp",
          label: "anon@mirror:21",
          host: "mirror",
          port: 21,
          user: "anonymous",
        },
      ]),
    );
    const out = migrateLegacyDrafts([]);
    // The good FTP row survives; the malformed SFTP key contributes 0.
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("ftp");
    expect(out[0].id).toBe("good-ftp");
  });
});

describe("smbToConn / ftpToConn — projection contract", () => {
  it("smbToConn sets rememberPassword=false and copies share + domain", () => {
    const out = smbToConn({
      id: "s-1",
      label: "lbl",
      host: "h",
      port: 1,
      user: "u",
      share: "share",
      domain: "DOM",
    });
    expect(out).toEqual<SavedConnection>({
      id: "s-1",
      kind: "smb",
      label: "lbl",
      host: "h",
      port: 1,
      user: "u",
      share: "share",
      domain: "DOM",
      rememberPassword: false,
    });
  });

  it("ftpToConn sets rememberPassword=false and omits SMB-only fields", () => {
    const out = ftpToConn({
      id: "f-1",
      label: "lbl",
      host: "h",
      port: 21,
      user: "u",
    });
    expect(out.kind).toBe("ftp");
    expect(out.share).toBeUndefined();
    expect(out.domain).toBeUndefined();
    expect(out.rememberPassword).toBe(false);
  });
});
