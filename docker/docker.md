# Docker test harness — SFTP / FTP / SMB

Spins up real SFTP, FTP, and SMB servers on `127.0.0.1` so the app (and the integration suite) hits real protocol implementations instead of mocks. Two ways to run it: the `docker compose` file in this folder, or one-shot `docker run` commands.

Endpoints (both modes):

| Protocol | Host:Port           | User       | Password    | Share / Path        |
| -------- | ------------------- | ---------- | ----------- | ------------------- |
| SFTP     | `127.0.0.1:2222`    | `testuser` | `skiffpass` | user home (`/config`) |
| FTP      | `127.0.0.1:2121`    | `testuser` | `skiffpass` | `/home/testuser`    |
| SMB      | `127.0.0.1:1445`    | `testuser` | `skiffpass` | share `testshare`   |

Credentials are deliberately weak and the servers only bind to `127.0.0.1` — never expose this stack to a public network.

## Option A — docker compose (recommended)

```bash
docker compose -f docker/docker-compose.yml up -d        # spin up all three
docker compose -f docker/docker-compose.yml down -v      # tear down + drop volumes
```

The compose file uses named volumes (no host folder mounted). If you want to point a server at a real folder on disk, use the `docker run` recipes below instead.

## Option B — docker run with a host folder mounted

Useful when you want to browse / sync your real files through the server (e.g. exercise Skiffsync against `~/`).

### macOS — mount `~/` (your home dir)

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

- For now on Windows just doing `D:/`. If you later want a path under your user profile (e.g. `C:/Users/<You>`), spaces in the path need quoting: `-v "C:/Users/Your Name:/share"`.
- Docker Desktop → Settings → Resources → File Sharing must include the drive (`D:`) before the mount will work on Windows.
- Stop / remove with `docker rm -f skiff-sftp skiff-ftp skiff-smb`.

## Connecting from the app

In Skiff Files: **Add connection** → pick SFTP / FTP / SMB → host `127.0.0.1`, port from the table above, user `testuser`, password `skiffpass`. SMB share name is `testshare`.
