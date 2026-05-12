import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  connCreateFtp,
  connCreateSftp,
  connCreateSmb,
  connDirSummary,
  connDisconnect,
  connHashSha256,
  connKnownHostsList,
  connKnownHostsRemove,
  connList,
  connListDir,
  connMkdir,
  connReadBase64,
  connReadText,
  connRemove,
  connRename,
  connStat,
  sshConfigHosts,
} from "./conn";

const mocked = vi.mocked(invoke);

beforeEach(() => {
  mocked.mockClear();
});

describe("api/conn typed wrappers", () => {
  it("calls the documented Tauri commands with the right arg shape", async () => {
    await sshConfigHosts();
    expect(mocked).toHaveBeenLastCalledWith("ssh_config_hosts");

    await connCreateSftp({ host: "h", user: "u", port: 22 });
    expect(mocked).toHaveBeenLastCalledWith("conn_create_sftp", {
      config: { host: "h", user: "u", port: 22 },
    });

    await connCreateFtp({ host: "h" });
    expect(mocked).toHaveBeenLastCalledWith("conn_create_ftp", {
      config: { host: "h" },
    });

    await connCreateSmb({
      host: "h",
      share: "Public",
      user: "u",
      password: "DUMMY",
    });
    expect(mocked).toHaveBeenLastCalledWith("conn_create_smb", {
      config: { host: "h", share: "Public", user: "u", password: "DUMMY" },
    });

    await connDisconnect("id");
    expect(mocked).toHaveBeenLastCalledWith("conn_disconnect", { id: "id" });

    await connList();
    expect(mocked).toHaveBeenLastCalledWith("conn_list");

    await connListDir("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_list_dir", {
      id: "id",
      path: "/p",
      options: undefined,
    });

    await connListDir("id", "/p", { showHidden: true });
    expect(mocked).toHaveBeenLastCalledWith("conn_list_dir", {
      id: "id",
      path: "/p",
      options: { showHidden: true },
    });

    await connStat("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_stat", {
      id: "id",
      path: "/p",
    });

    await connReadText("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_read_text", {
      id: "id",
      path: "/p",
    });

    await connReadBase64("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_read_base64", {
      id: "id",
      path: "/p",
    });

    await connDirSummary("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_dir_summary", {
      id: "id",
      path: "/p",
    });

    await connMkdir("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_mkdir", {
      id: "id",
      path: "/p",
    });

    await connRename("id", "/a", "/b");
    expect(mocked).toHaveBeenLastCalledWith("conn_rename", {
      id: "id",
      from: "/a",
      to: "/b",
    });

    await connRemove("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_remove", {
      id: "id",
      path: "/p",
    });

    await connKnownHostsList();
    expect(mocked).toHaveBeenLastCalledWith("conn_known_hosts_list");

    await connKnownHostsRemove("h:22");
    expect(mocked).toHaveBeenLastCalledWith("conn_known_hosts_remove", {
      keyId: "h:22",
    });

    await connHashSha256("id", "/p");
    expect(mocked).toHaveBeenLastCalledWith("conn_hash_sha256", {
      id: "id",
      path: "/p",
    });
  });
});
