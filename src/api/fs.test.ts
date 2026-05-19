import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  fsCanonicalize,
  fsCompressZip,
  fsCopyFile,
  fsCopyRecursive,
  fsCreateEmptyFile,
  fsDirSummary,
  fsDiskSpace,
  fsExtractZip,
  fsFind,
  fsHashSha256,
  fsHomeDir,
  fsImageExif,
  fsImageRotate,
  fsListDir,
  fsMkdir,
  fsMounts,
  fsOpenInTerminal,
  fsOpenWithDefault,
  fsReadBase64,
  fsReadText,
  fsRemove,
  fsRename,
  fsRevealInOs,
  fsStat,
  fsThumbnail,
  fsThumbnailClear,
  fsThumbnailStats,
  fsTrash,
  fsTrashMany,
  fsTrashPath,
  fsWatchClear,
  fsWatchSet,
  fetchLatestRelease,
  getAppVersion,
  getBuildTimestamp,
  windowOpenAt,
  windowOpenNew,
  windowSetAlwaysOnTop,
} from "./fs";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
});

describe("api/fs typed wrappers", () => {
  it("invokes the documented Tauri command names", async () => {
    await getAppVersion();
    expect(mocked).toHaveBeenLastCalledWith("get_app_version");

    await getBuildTimestamp();
    expect(mocked).toHaveBeenLastCalledWith("get_build_timestamp");

    await fsHomeDir();
    expect(mocked).toHaveBeenLastCalledWith("fs_home_dir");

    await windowOpenNew();
    expect(mocked).toHaveBeenLastCalledWith("window_open_new");

    await windowOpenAt("/p");
    expect(mocked).toHaveBeenLastCalledWith("window_open_at", { path: "/p" });

    await fsWatchSet("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_watch_set", { path: "/p" });

    await fsWatchClear();
    expect(mocked).toHaveBeenLastCalledWith("fs_watch_clear");

    await fsListDir("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_list_dir", {
      path: "/p",
      options: undefined,
    });

    await fsListDir("/p", { showHidden: true });
    expect(mocked).toHaveBeenLastCalledWith("fs_list_dir", {
      path: "/p",
      options: { showHidden: true },
    });

    await fsStat("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_stat", { path: "/p" });

    await fsMkdir("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_mkdir", { path: "/p" });

    await fsRename("/a", "/b");
    expect(mocked).toHaveBeenLastCalledWith("fs_rename", { from: "/a", to: "/b" });

    await fsRemove("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_remove", { path: "/p" });

    await fsTrash("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_trash", { path: "/p" });

    await fsTrashMany(["/a", "/b"]);
    expect(mocked).toHaveBeenLastCalledWith("fs_trash_many", {
      paths: ["/a", "/b"],
    });

    await fsRevealInOs("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_reveal_in_os", { path: "/p" });

    await fsOpenWithDefault("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_open_with_default", {
      path: "/p",
    });

    await fsOpenInTerminal("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_open_in_terminal", {
      path: "/p",
    });

    await fsCreateEmptyFile("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_create_empty_file", {
      path: "/p",
    });

    await fsCopyRecursive("/a", "/b");
    expect(mocked).toHaveBeenLastCalledWith("fs_copy_recursive", {
      from: "/a",
      to: "/b",
    });

    await fsTrashPath();
    expect(mocked).toHaveBeenLastCalledWith("fs_trash_path");

    await fsCompressZip(["/a"], "/out.zip");
    expect(mocked).toHaveBeenLastCalledWith("fs_compress_zip", {
      paths: ["/a"],
      destZip: "/out.zip",
    });

    await fsExtractZip("/z.zip", "/d");
    expect(mocked).toHaveBeenLastCalledWith("fs_extract_zip", {
      zipPath: "/z.zip",
      destDir: "/d",
    });

    await fsMounts();
    expect(mocked).toHaveBeenLastCalledWith("fs_mounts");

    await fsHashSha256("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_hash_sha256", { path: "/p" });

    await fsImageExif("/p.jpg");
    expect(mocked).toHaveBeenLastCalledWith("fs_image_exif", { path: "/p.jpg" });

    await fsImageRotate("/p.jpg", 90);
    expect(mocked).toHaveBeenLastCalledWith("fs_image_rotate", {
      path: "/p.jpg",
      degrees: 90,
    });

    await fsThumbnail("/p.jpg", 128);
    expect(mocked).toHaveBeenLastCalledWith("fs_thumbnail", {
      path: "/p.jpg",
      sizePx: 128,
    });

    await fsThumbnailStats();
    expect(mocked).toHaveBeenLastCalledWith("fs_thumbnail_stats");

    await fsThumbnailClear();
    expect(mocked).toHaveBeenLastCalledWith("fs_thumbnail_clear");

    await fsDiskSpace("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_disk_space", { path: "/p" });

    await fsCopyFile("/a", "/b");
    expect(mocked).toHaveBeenLastCalledWith("fs_copy_file", {
      from: "/a",
      to: "/b",
    });

    await fsCanonicalize("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_canonicalize", { path: "/p" });

    await fsReadText("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_read_text", { path: "/p" });

    await fsReadBase64("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_read_base64", { path: "/p" });

    await fsDirSummary("/p");
    expect(mocked).toHaveBeenLastCalledWith("fs_dir_summary", { path: "/p" });

    await windowSetAlwaysOnTop(true);
    expect(mocked).toHaveBeenLastCalledWith("window_set_always_on_top", {
      enabled: true,
    });
  });

  it("fsFind defaults regex/caseSensitive to false", async () => {
    await fsFind("/p", "needle");
    expect(mocked).toHaveBeenLastCalledWith("fs_find", {
      path: "/p",
      query: "needle",
      regex: false,
      caseSensitive: false,
    });
  });

  it("fsFind forwards explicit flags", async () => {
    await fsFind("/p", "n.*", { regex: true, caseSensitive: true });
    expect(mocked).toHaveBeenLastCalledWith("fs_find", {
      path: "/p",
      query: "n.*",
      regex: true,
      caseSensitive: true,
    });
  });
});

describe("fetchLatestRelease", () => {
  // Pin global.fetch per test so we don't leak mocks between cases.
  // Real network is never hit — every test stubs the response shape.
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  it("hits the public releases/latest endpoint with the GitHub Accept header", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ tag_name: "v0.2.302", published_at: "2026-05-15T12:37:00Z" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const out = await fetchLatestRelease();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/synle/skiff-files/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    expect(out).toEqual({ tagName: "v0.2.302", publishedAt: "2026-05-15T12:37:00Z" });
  });

  it("returns null on non-200 (rate limit, gone, etc.) without throwing", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("rate limited", { status: 403 }));
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null on network failure (offline)", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null on malformed JSON (missing tag_name)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ published_at: "2026-05-15T12:37:00Z" }), {
        status: 200,
      }),
    );
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("normalizes a missing publishedAt to null rather than undefined", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ tag_name: "v0.2.302" }), { status: 200 }),
    );
    expect(await fetchLatestRelease()).toEqual({
      tagName: "v0.2.302",
      publishedAt: null,
    });
  });
});
