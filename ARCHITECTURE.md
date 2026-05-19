# skiff-files — Architecture

## High-Level Overview

Skiff Files is a cross-platform desktop file explorer built on **Tauri v2** with **FTP / SFTP / SMB** support and a smart-sync engine (TeraCopy-parity conflict policies, kernel-accelerated local copy via `copy_file_range` / `clonefile`).

Two layers, one IPC channel:

```
┌─────────────────────────────────────────────────────┐
│  React 19 UI  (src/)                                │
│   pages/ · components/ · state/ · api/ · util/      │
└───────────────────────┬─────────────────────────────┘
                        │  invoke / events
┌───────────────────────┴─────────────────────────────┐
│  Rust  (src-tauri/src/)                             │
│   lib.rs · commands.rs · fs/ · sync/                │
└─────────────────────────────────────────────────────┘
```

**Runtime model.** Frontend is a Vite-built SPA served under `tauri://` via `HashRouter`. Rust commands run on Tauri's worker pool; sync jobs spawn dedicated `std::thread`s (local engine, blocking `std::fs`) or per-job tokio runtimes (cross-protocol engine). Four globals are `manage`d at builder time: `Arc<Registry>` (live SFTP / FTP / SMB connections), `Arc<JobRegistry>` (sync jobs with cancel/pause tokens), `Arc<ResolverHub>` (conflict prompt waiters using `Mutex<HashMap> + Condvar`), `Arc<FsWatchState>` (notify-based fs watcher subscriptions, plus the `Arc<ThumbnailCache>` opened against the app data dir on startup).

**UI ↔ Rust flow.** Components dispatch through typed wrappers in `src/api/`; `client.ts` parses `sftp://<id>/<path>` / `ftp://` / `smb://` URLs and routes via a single `dispatchByLocation<T>(path, spec)` helper, with `local` and optional `remote` handlers per verb. Adding a backend means extending the `Backend` union in `util/location.ts` — TypeScript surfaces every verb that needs a `remote` handler. Long-running operations emit progress / done / error / conflict events that `api/sync.ts` subscribes to.

**Path scheme.** One address-bar form for all backends: `/Users/syle/...` or `C:\\Users\\...` for local, `sftp://<conn_id>/<path>` / `ftp://<conn_id>/<path>` / `smb://<conn_id>/<share-relative-path>` for remote. `util/location.parseLocation` is the single splitter.

## Key Directories

| Path | Contents |
|---|---|
| `src/` | React frontend (TypeScript) |
| `src/pages/` | Browser, Connections, Transfers, Settings routes |
| `src/components/` | FileList, Toolbar, PathBar, Sidebar, Modals, BrowserTabs |
| `src/state/` | `SettingsProvider` — the only Context |
| `src/api/` | Typed `invoke` wrappers: `fs.ts`, `conn.ts`, `sync.ts`, `client.ts` |
| `src/util/` | Pure helpers (no React/api/state imports) — `location.ts` etc. |
| `src/i18n/`, `src/theme/`, `src/test/` | Translations, MUI theme, test helpers |
| `src-tauri/` | Rust backend + Tauri config |
| `src-tauri/src/fs/` | `local.rs` (std::fs), `sftp.rs` (russh + russh-sftp), `ftp.rs` (suppaftp), `smb.rs` (smb2 — pure-Rust SMB 2/3), `registry.rs` (connection map), `ssh_config.rs`, `known_hosts.rs`, `watch.rs` (notify-based), `thumbnail.rs` (SQLite cache), `types.rs`, `icons.rs` |
| `src-tauri/src/sync/` | `plan.rs`, `engine.rs` (local, sync), `cross_engine.rs` + `backend.rs` (async tokio), `resolver.rs`, `stamp.rs`, `dedup.rs`, `repo.rs`, `registry.rs` (jobs), `types.rs` |
| `src-tauri/src/{creds,crash,health,permissions,win_cmd}.rs` | OS keychain wrapper (`creds`), opt-in local crash log hook (`crash`), `127.0.0.1:39871` ping server (`health`), macOS Full Disk Access TCC probe + System Settings deep-link (`permissions`), Windows `CREATE_NO_WINDOW` spawn helper (`win_cmd`) |
| `src-tauri/capabilities/` | Tauri v2 capability allowlists |
| `.github/workflows/` | `build.yml`, `integration.yml`, `release-official.yml`, `release-beta.yml`, `automerge.yml` |
| `docker/` | Local test fixtures (SFTP / FTP / SMB servers) |

## Important Files

| File | Role |
|---|---|
| `src-tauri/tauri.conf.json` | Single source of truth for `version`; bundle targets `dmg / nsis / deb / appimage`; window config; identifier `com.synle.skiff-files` |
| `src-tauri/Cargo.toml` | Rust deps (`tauri`, `tokio`, `russh` + `russh-sftp` for SFTP, `suppaftp` for FTP, `smb2` for SMB, `notify` for fs watching, `rusqlite` for the thumbnail cache, `md5`) |
| `src-tauri/build.rs` | Exposes `APP_VERSION` from `tauri.conf.json` to Rust via `env!()`; dev builds append `[DEV]`, CI sets `TAURI_RELEASE=true` for clean strings |
| `src-tauri/src/main.rs` | Thin entry — calls `skiff_files_lib::run()` |
| `src-tauri/src/lib.rs` | `tauri::Builder` + `invoke_handler!` registration |
| `src-tauri/src/commands.rs` | The only file with `#[tauri::command]`; thin adapters returning `FsResult<T>` (= `Result<T, String>`) |
| `src/main.tsx` | React entry; mounts `HashRouter` (required under `tauri://`) |
| `src/App.tsx` | Route table, root-mounted modals (`ShortcutsModal`, `ConflictModal`, `QuickJump`), `buildCommandActions` dispatch site for `skiff:*` window CustomEvents |
| `src/api/client.ts` | Backend-agnostic dispatch via `dispatchByLocation`; regression suite in `client.test.ts` pins 69 per-backend routes |
| `src/state/settings.tsx` | Seeds from `localStorage`, rehydrates from disk via `settings_load`; every change writes to both |
| `package.json` | Scripts: `dev`, `build`, `tauri:dev`, `tauri:build`, `test` (vitest), `test:coverage`, `typecheck`, `format` |
| `vite.config.ts`, `tsconfig.json` | Frontend build / TS config |
| `index.html` | Vite entry |

## Sync Engine Detail

Two engines because local + cross-protocol benefit from different runtime models:

- **Local engine** (`engine.rs` + `plan.rs`) — synchronous, walks tree with `std::fs`, kernel-accelerated copy path (`copy_file_range` / `clonefile`) with EPERM fallback. Used by `sync_start_local` and `sync_start_repo`.
- **Cross-protocol engine** (`cross_engine.rs` + `backend.rs`) — async tokio; `Backend` enum (`Local | Sftp(Arc<SftpClient>) | Smb(Arc<SmbConnection>)`) abstracts metadata / read / write / mkdir_p / rename / streaming `copy_file`. Multi-GB files stream via `tokio::io::copy`. Used by `sync_start_cross`; pure-local pairs short-circuit to the local engine. FTP transfers go through the same path via `conn_*` commands on each side rather than a `Backend::Ftp` variant — FTP doesn't expose a streaming `AsyncRead`/`AsyncWrite` shape cleanly.

**Conflict resolution.** 9-variant `ConflictPolicy`: pre-decided (`skip`, `overwrite`, `keepBoth`), smart-batch / TeraCopy-parity (`overwriteOlder`, `replaceSmaller`, `replaceIfSizeDifferent`, `renameTarget`, `renameOlderTarget`), and `prompt`. The Prompt protocol parks the engine on `ResolverHub::wait_for(conflict_id)` after emitting `sync:conflict`; the frontend `ConflictModal` calls `sync_resolve_conflict(jobId, conflictId, decision)` to wake it. Apply-to-all caches in a per-job closure.

**`cpsync` family ports** (`stamp.rs`, `dedup.rs`, `repo.rs`): `cpstamp` (timestamp-suffixed single-file copy), `dedup` (size-group + MD5 compare → `_recycleBin/`, idempotent), `cprepo` (`git ls-files -z`-driven copy, skips untracked / ignored).

## Cross-Cutting Conventions

- **Tabs**: `BrowserTabs` keeps all tabs mounted, toggles `display: none`. Each `Browser` receives `isActive`; window listeners gate on it.
- **Cross-component coordination**: `skiff:<verb>` window CustomEvents (refresh, new-tab, run-sync-job, restore-workspace, etc.). Payloads accept bare strings (legacy) or `{id, ...}` objects.
- **Saved-data parity** (workspaces / selections / searches / sync jobs / bookmarks): every type ships five surfaces — settings persistence, sidebar section with rename/delete/drag-reorder, palette actions, settings management block, and a `skiff:*` event for shared execution.
- **Settings persistence**: `localStorage` hot cache + disk via `settings_save` (atomic temp+rename); double-write so tests and browser-dev mode work without disk.
- **Dependency rules**: `util/` is pure; `api/` doesn't render; `components/` doesn't fetch; `pages/` orchestrate; `state/settings.tsx` is the only Context.

## Build & Release Flow

- **Dev**: `npm run tauri:dev` — Vite at `localhost:1420` + `cargo run` shell.
- **Production**: `npm run tauri:build` runs `tsc --noEmit && vite build` then `cargo build --release`; Tauri bundles `dmg` (macOS), `nsis` (Windows), `deb` / `appimage` (Linux).
- **Versioning**: bump `src-tauri/tauri.conf.json#version`; `build.rs` propagates as `APP_VERSION` to Rust (`env!("APP_VERSION")`).
- **CI**: `.github/workflows/build.yml` and `integration.yml` run on PRs; `automerge.yml` handles squash-auto-merge.
- **Release**: `release-official.yml` (workflow_dispatch) produces a tagged GitHub Release with platform installers; `release-beta.yml` for prerelease channel. The release skill (`/sy-release`) dispatches against the default branch with an explicit `tag` input derived from `tauri.conf.json#version`.
