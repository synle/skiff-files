# Docker test harness — SFTP / FTP / SMB

Spins up real SFTP, FTP, and SMB servers on `127.0.0.1` so the app (and the integration suite) hits real protocol implementations instead of mocks. Two ways to run it: the `docker compose` files in this folder, or one-shot `docker run` commands.

Endpoints (all modes):

| Protocol | Host:Port           | User       | Password    | Share / Path          |
| -------- | ------------------- | ---------- | ----------- | --------------------- |
| SFTP     | `127.0.0.1:2222`    | `testuser` | `skiffpass` | user home (`/config`) |
| FTP      | `127.0.0.1:2121`    | `testuser` | `skiffpass` | `/home/testuser`      |
| SMB      | `127.0.0.1:1445`    | `testuser` | `skiffpass` | share `testshare`     |

Credentials are deliberately weak and the servers only bind to `127.0.0.1` — never expose this stack to a public network.

## Option A — docker compose

Two variants — pick the one matching your host:

```bash
# macOS / Linux — mounts ${HOME} into every server
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml down

# Windows (PowerShell / cmd) — mounts D:/ into every server
docker compose -f docker/docker-compose.windows.yml up -d
docker compose -f docker/docker-compose.windows.yml down
```

Both files mount a real host folder (no named volumes) so anything you read / write through the protocols hits the live filesystem.

## Option B — docker run with a host folder mounted

One-shot equivalents of the compose stacks — handy when you only want one of the three servers.

### macOS / Linux — mount `~/` (your home dir)

```bash
docker run -d --name skiff-sftp -p 127.0.0.1:2222:2222 -e USER_NAME=testuser -e USER_PASSWORD=skiffpass -e PASSWORD_ACCESS=true -v ~/:/config lscr.io/linuxserver/openssh-server:latest
docker run -d --name skiff-ftp -p 127.0.0.1:2121:21 -p 127.0.0.1:21000-21009:21000-21009 -e "USERS=testuser|skiffpass|/home/testuser|1000" -e ADDRESS=127.0.0.1 -e MIN_PORT=21000 -e MAX_PORT=21009 -v ~/:/home/testuser delfer/alpine-ftp-server:latest
docker run -d --name skiff-smb -p 127.0.0.1:1445:445 -v ~/:/share dperson/samba:latest -u "testuser;skiffpass" -s "testshare;/share;yes;no;no;testuser;testuser" -p
```

### Windows — mount `D:/` (PowerShell or cmd)

```powershell
docker run -d --name skiff-sftp -p 127.0.0.1:2222:2222 -e USER_NAME=testuser -e USER_PASSWORD=skiffpass -e PASSWORD_ACCESS=true -v D:/:/config lscr.io/linuxserver/openssh-server:latest
docker run -d --name skiff-ftp -p 127.0.0.1:2121:21 -p 127.0.0.1:21000-21009:21000-21009 -e "USERS=testuser|skiffpass|/home/testuser|1000" -e ADDRESS=127.0.0.1 -e MIN_PORT=21000 -e MAX_PORT=21009 -v D:/:/home/testuser delfer/alpine-ftp-server:latest
docker run -d --name skiff-smb -p 127.0.0.1:1445:445 -v D:/:/share dperson/samba:latest -u "testuser;skiffpass" -s "testshare;/share;yes;no;no;testuser;testuser" -p
```

Notes:

- On Windows the recipes mount `D:/`. To use a path under your user profile (e.g. `C:/Users/<You>`), spaces in the path need quoting: `-v "C:/Users/Your Name:/share"`.
- Docker Desktop → Settings → Resources → File Sharing must include the drive (e.g. `D:`) before the mount will work on Windows.
- Stop / remove the standalone containers with `docker rm -f skiff-sftp skiff-ftp skiff-smb`.

## Connecting from Skiff Files

Open the app → **Connections** in the sidebar → **+ Add connection** → pick the protocol → fill in the fields below → **Save / Connect**.

### SFTP

| Field    | Value         |
| -------- | ------------- |
| Host     | `127.0.0.1`   |
| Port     | `2222`        |
| Username | `testuser`    |
| Password | `skiffpass`   |

Files appear under the SFTP user's home (the container path `/config`), which is your `${HOME}` (macOS / Linux) or `D:/` (Windows) on the host.

### FTP

| Field    | Value         |
| -------- | ------------- |
| Host     | `127.0.0.1`   |
| Port     | `2121`        |
| Username | `testuser`    |
| Password | `skiffpass`   |

Passive-mode data channel uses ports `21000–21009`, which the compose file forwards. If a corporate firewall blocks them, FTP listing will hang — switch to SFTP or SMB.

### SMB

| Field           | Value         |
| --------------- | ------------- |
| Host            | `127.0.0.1`   |
| Port            | `1445`        |
| Username        | `testuser`    |
| Password        | `skiffpass`   |
| Share (optional)| `testshare`   |

If you leave **Share** blank, the app lists shares at the root and you can drill into `testshare` from there. The first listing after container start can be slow (~5–10 s) while Samba finishes initializing.

## Quick sanity check from the terminal

Useful if a Skiff connection won't open and you need to isolate the harness from the app:

```bash
# SFTP — should land you in /config (your $HOME)
sftp -P 2222 testuser@127.0.0.1            # password: skiffpass

# FTP — should list /home/testuser
curl -u testuser:skiffpass ftp://127.0.0.1:2121/

# SMB — should list "testshare" among the shares
smbclient -L //127.0.0.1 -p 1445 -U testuser%skiffpass
```

## Windows + WSL (Ubuntu)

If you started the harness on the **Windows** side (Docker Desktop running in Windows mode, ports bound to `127.0.0.1` on the Windows host) and you want to connect from a **WSL Ubuntu** distro running on the same machine, the right host depends on Docker Desktop's WSL integration setting.

**Recommended setup — WSL integration ON** (Docker Desktop → Settings → Resources → WSL integration → enable for your distro):

- Ports published to `127.0.0.1` on Windows are mirrored into WSL. From inside Ubuntu, just use `localhost` / `127.0.0.1` and the ports above — no extra config needed.

**Without WSL integration** (or if `localhost` doesn't resolve):

- The Docker Desktop services are reachable from WSL through Windows' loopback adapter. Use one of:
  - `host.docker.internal` (the conventional alias — works from WSL when Docker Desktop is running)
  - the Windows host IP from the WSL2 default gateway: `ip route show | awk '/default/ {print $3}'` (typically `172.x.x.1`)

  Example from WSL:

  ```bash
  HOST=$(ip route show | awk '/default/ {print $3}')   # or: HOST=host.docker.internal
  sftp -P 2222 testuser@$HOST
  curl -u testuser:skiffpass ftp://$HOST:2121/
  smbclient -L //$HOST -p 1445 -U testuser%skiffpass
  ```

  In Skiff Files running inside WSL, plug the same address into the **Host** field (everything else stays the same as the tables above).

Caveats:

- The bind address `127.0.0.1` is on the **Windows** host — WSL sees it via Docker Desktop's port forwarding, not as a raw Windows port. Disabling Docker Desktop breaks the route.
- If you run Skiff Files on Windows (not inside WSL) you don't need any of this — `127.0.0.1` Just Works.
- If you re-run the harness *inside* WSL (i.e. `docker compose up` from an Ubuntu shell using Docker Desktop's WSL backend), the volume mount should reference the Linux-side path (`/mnt/d/...` for the D drive, `$HOME` for your WSL home) — the `D:/` mount in `docker-compose.windows.yml` is for the Windows-side daemon only.
