# Docker test harness — SFTP / FTP / SMB

Spins up real SFTP, FTP, and SMB servers on `127.0.0.1` so the app (and the integration suite) hits real protocol implementations instead of mocks. Two ways to run it: the `docker compose` files in this folder, or one-shot `docker run` commands.

Endpoints (all modes):

| Protocol         | Host:Port           | User       | Auth                 | Path                             |
| ---------------- | ------------------- | ---------- | -------------------- | -------------------------------- |
| SFTP (password)  | `127.0.0.1:2222`    | `skiff`    | password `password`  | `data/` (your `${HOME}` / `D:/`) |
| SFTP (key)       | `127.0.0.1:2223`    | `skiff`    | `~/.ssh/id_rsa`      | `data/` (your `${HOME}` / `D:/`) |
| FTP              | `127.0.0.1:2121`    | `skiff`    | password `password`  | `/home/skiff`                    |
| SMB              | `127.0.0.1:1445`    | `skiff`    | password `password`  | share `testshare`                |

Credentials are deliberately weak and the servers only bind to `127.0.0.1` — never expose this stack to a public network.

## Option A — docker compose

Three variants — pick the one matching your use case:

```bash
# macOS / Linux — mounts ${HOME} into every server (browse real files)
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml down

# Windows (PowerShell / cmd) — mounts D:/ into every server
docker compose -f docker/docker-compose.windows.yml up -d
docker compose -f docker/docker-compose.windows.yml down

# Integration tests — no host mounts, isolated tmpfs, `testuser` / `Sk1ffCI!Pass2026`
docker compose -f docker/docker-compose.ci.yml up -d
cd src-tauri && SKIFF_INTEGRATION=1 cargo test --no-default-features \
    --test remote_integration -- --test-threads=1
docker compose -f docker/docker-compose.ci.yml down -v
```

The first two mount a real host folder (no named volumes) so anything you read / write through the protocols hits the live filesystem; they use `skiff` / `password`.

The CI variant is what `.github/workflows/integration.yml` runs — it uses tmpfs-backed writable dirs (no host mount) and the `testuser` / `Sk1ffCI!Pass2026` credentials the integration suite expects. Use this if you want to reproduce a CI failure locally without touching your `${HOME}`. (The mixed-case + digit + symbol shape exists because `delfer/alpine-ftp-server:latest` runs `passwd` under PAM at first boot; the prior fixture `skiffpass` was rejected as "too weak" by a 2026-05 upstream PAM tightening and the FTP daemon never started.)

## Option B — docker run with a host folder mounted

One-shot equivalents of the compose stacks — handy when you only want one of the three servers.

### macOS / Linux — mount `~/` (your home dir)

```bash
docker run -d --name skiff-sftp -p 127.0.0.1:2222:22 -v ~/:/home/skiff/data atmoz/sftp:alpine skiff:password:1001
docker run -d --name skiff-sftp-key -p 127.0.0.1:2223:22 -v ~/:/home/skiff/data -v ~/.ssh/id_rsa.pub:/home/skiff/.ssh/keys/id_rsa.pub:ro atmoz/sftp:alpine skiff::1001
docker run -d --name skiff-ftp -p 127.0.0.1:2121:21 -p 127.0.0.1:21000-21009:21000-21009 -e "USERS=skiff|password|/home/skiff|1000" -e ADDRESS=127.0.0.1 -e MIN_PORT=21000 -e MAX_PORT=21009 -v ~/:/home/skiff delfer/alpine-ftp-server:latest
docker run -d --name skiff-smb -p 127.0.0.1:1445:445 -v ~/:/share dperson/samba:latest -u "skiff;password" -s "testshare;/share;yes;no;no;skiff;skiff" -p
```

### Windows — mount `D:/` (PowerShell or cmd)

```powershell
docker run -d --name skiff-sftp -p 127.0.0.1:2222:22 -v D:/:/home/skiff/data atmoz/sftp:alpine skiff:password:1001
docker run -d --name skiff-sftp-key -p 127.0.0.1:2223:22 -v D:/:/home/skiff/data -v %USERPROFILE%/.ssh/id_rsa.pub:/home/skiff/.ssh/keys/id_rsa.pub:ro atmoz/sftp:alpine skiff::1001
docker run -d --name skiff-ftp -p 127.0.0.1:2121:21 -p 127.0.0.1:21000-21009:21000-21009 -e "USERS=skiff|password|/home/skiff|1000" -e ADDRESS=127.0.0.1 -e MIN_PORT=21000 -e MAX_PORT=21009 -v D:/:/home/skiff delfer/alpine-ftp-server:latest
docker run -d --name skiff-smb -p 127.0.0.1:1445:445 -v D:/:/share dperson/samba:latest -u "skiff;password" -s "testshare;/share;yes;no;no;skiff;skiff" -p
```

Notes:

- On Windows the recipes mount `D:/`. To use a path under your user profile (e.g. `C:/Users/<You>`), spaces in the path need quoting: `-v "C:/Users/Your Name:/share"`.
- Docker Desktop → Settings → Resources → File Sharing must include the drive (e.g. `D:`) before the mount will work on Windows.
- Stop / remove the standalone containers with `docker rm -f skiff-sftp skiff-sftp-key skiff-ftp skiff-smb`.

## Connecting from Skiff Files

Open the app → **Connections** in the sidebar → **+ Add connection** → pick the protocol → fill in the fields below → **Save / Connect**.

### SFTP — password

| Field    | Value         |
| -------- | ------------- |
| Host     | `127.0.0.1`   |
| Port     | `2222`        |
| Username | `skiff`       |
| Password | `password`    |

Login lands in the chroot root and shows a single `data/` directory — that's your `${HOME}` (macOS / Linux) or `D:/` (Windows) on the host. The chroot wrapper requires the user's home itself to stay root-owned, so the host folder is mounted one level deeper. In Skiff Files, expand `data/` to browse your files.

### SFTP — private key

Same `skiff` user, same `data/` layout, but on port **`2223`** and password auth is disabled. The compose file mounts `~/.ssh/id_rsa.pub` (macOS / Linux) or `%USERPROFILE%\.ssh\id_rsa.pub` (Windows) into the container, which `atmoz/sftp` installs as `authorized_keys` at startup.

| Field      | Value                 |
| ---------- | --------------------- |
| Host       | `127.0.0.1`           |
| Port       | `2223`                |
| Username   | `skiff`               |
| Auth       | Private key           |
| Key file   | `~/.ssh/id_rsa`       |

Sanity check from the terminal:

```bash
sftp -P 2223 -i ~/.ssh/id_rsa skiff@127.0.0.1            # no password prompt
```

If your local key lives somewhere other than `~/.ssh/id_rsa.pub`, edit the second `volumes:` entry on `skiff-sftp-key` in both `docker/docker-compose.yml` (macOS / Linux) and `docker/docker-compose.windows.yml` (Windows), then recreate with `docker compose -f <file> up -d --force-recreate skiff-sftp-key`. In the **Private key path** field, `~` / `~/...` are expanded to your home directory — absolute paths also work.

### FTP

| Field    | Value         |
| -------- | ------------- |
| Host     | `127.0.0.1`   |
| Port     | `2121`        |
| Username | `skiff`    |
| Password | `password`   |

Passive-mode data channel uses ports `21000–21009`, which the compose file forwards. If a corporate firewall blocks them, FTP listing will hang — switch to SFTP or SMB.

### SMB

| Field           | Value         |
| --------------- | ------------- |
| Host            | `127.0.0.1`   |
| Port            | `1445`        |
| Username        | `skiff`    |
| Password        | `password`   |
| Share (optional)| `testshare`   |

If you leave **Share** blank, the app lists shares at the root and you can drill into `testshare` from there. The first listing after container start can be slow (~5–10 s) while Samba finishes initializing.

## Quick sanity check from the terminal

Useful if a Skiff connection won't open and you need to isolate the harness from the app:

```bash
# SFTP (password) — should drop you into a chroot showing a single "data/" dir (your $HOME)
sftp -P 2222 skiff@127.0.0.1                            # password: password

# SFTP (key) — same layout, no password prompt
sftp -P 2223 -i ~/.ssh/id_rsa skiff@127.0.0.1

# FTP — should list /home/skiff
curl -u skiff:password ftp://127.0.0.1:2121/

# SMB — should list "testshare" among the shares
smbclient -L //127.0.0.1 -p 1445 -U skiff%password
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
  sftp -P 2222 skiff@$HOST
  curl -u skiff:password ftp://$HOST:2121/
  smbclient -L //$HOST -p 1445 -U skiff%password
  ```

  In Skiff Files running inside WSL, plug the same address into the **Host** field (everything else stays the same as the tables above).

Caveats:

- The bind address `127.0.0.1` is on the **Windows** host — WSL sees it via Docker Desktop's port forwarding, not as a raw Windows port. Disabling Docker Desktop breaks the route.
- If you run Skiff Files on Windows (not inside WSL) you don't need any of this — `127.0.0.1` Just Works.
- If you re-run the harness *inside* WSL (i.e. `docker compose up` from an Ubuntu shell using Docker Desktop's WSL backend), the volume mount should reference the Linux-side path (`/mnt/d/...` for the D drive, `$HOME` for your WSL home) — the `D:/` mount in `docker-compose.windows.yml` is for the Windows-side daemon only.
