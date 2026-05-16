# skiff-files

Fast cross-platform file explorer with FTP / SFTP / SMB and a smart-sync engine. Built with Tauri v2 (Rust backend) and React 19 + TypeScript + MUI on Vite.

## Quick Start

Install dependencies:

```bash
npm ci || npm install --no-fund --prefer-offline
```

Run the full desktop app in dev mode (Rust + Vite together):

```bash
npm run tauri:dev
```

Frontend-only dev (browser preview at http://localhost:1420, faster UI iteration):

```bash
npm run dev
```

## Remote-backend test harness (SFTP / FTP / SMB)

Need real remote servers to develop against? There's a docker-based harness in [`docker/`](./docker/) that spins up SFTP, FTP, and SMB on `127.0.0.1`. Both a `docker-compose.yml` (one-shot, named volumes) and `docker run` recipes (mount a host folder like `~/` on macOS or `D:/` on Windows) are documented in [`docker/docker.md`](./docker/docker.md) — see there for full commands, endpoints, and credentials.
