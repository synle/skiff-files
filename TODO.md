# Skiff Files — Implementation Plan

> **Skiff Files** — a fast, cross-platform desktop file explorer for Windows / macOS / Linux. Built on **Tauri v2** for a small native bundle. First-class support for local FS, **FTP/FTPS**, **SSH/SFTP**, **SMB/Samba**, and (optional) **NTFS** mounts. Ships with **`Skiffsync`**, a `cpsync`-inspired smart-copy engine that skips unchanged files across protocols.

**Repo slug:** `skiff-files` · **Identifier:** `com.synle.skiff-files` · **Binary:** `Skiff Files`

Inspirations:

- `~/git/bashrc/software/scripts/bash-file-utils.profile.bash` — `cpsync`, `cpstamp`, `cprepo`, `cpfiles`, `dedup`, `pack_text` (skip-by-size, ETA, cross-device-safe copies)
- `~/git/sqlui-native` — connection-manager UX, multi-tab/multi-host workflow, release pipeline
- `~/git/display-dj` — Tauri v2 + React 19 + MUI v9 layout, beta/official release flow
- `~/git/tauri-desktop-raw-template` — baseline scaffold, build/release workflows

---

## UX & UI Vision

The look should feel familiar to anyone who's used Finder / Explorer / Files / Dolphin, but lean toward power-user density (think VS Code's file panel meets FileZilla's two-pane transfer view).

### Window layout (default)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ◀ ▶ ▲ ⟳   /Users/syle/git/file-explorer                          🔍  ⚙  ☾  │  ← top bar
├────────────┬─────────────────────────────────────────────────────────────────┤
│ ▾ FAVS     │  Name              Size     Modified         Kind                │
│   Home     │  ▸ src              —       2026-05-06 ...   Folder              │  ← main pane
│   Desktop  │  ▸ src-tauri        —       2026-05-06 ...   Folder              │     (list / tile /
│   Down…    │  • TODO.md          12 KB   2026-05-06 ...   Markdown            │      column /
│ ▾ NETWORK  │  • README.md        3 KB    2026-05-06 ...   Markdown            │      gallery)
│   ● home-srv (sftp)              ↑ uploading 2/14 · 14 MB/s · ETA 0:02       │
│   ○ nas (smb)                    ─                                            │
│   ○ ftp.example.com              ─                                            │
│ ▾ DEVICES  │                                                                  │
│   Macintosh HD                                                                │
│   USB-NTFS (ro)                                                               │
├────────────┴─────────────────────────────────────────────────────────────────┤
│  3 of 14 selected · 412 MB · Free 218 GB                                     │  ← status bar
└──────────────────────────────────────────────────────────────────────────────┘
```

Optional **two-pane mode** (split vertically) for drag-drop transfers between local ↔ remote, FileZilla-style. Toggle with Cmd/Ctrl+Shift+\.

### View modes (per-folder, persisted)

- **List** — dense rows with sortable columns (default). Keyboard-first.
- **Tile / Grid** — medium thumbnails for image/folder browsing.
- **Gallery** — large thumbnails, single column for media folders.
- **Column (Miller)** — Finder-style cascading panes for deep trees.
- **Tree-only** — pure tree, no file pane (rare).

Each folder remembers its preferred view + sort in `settings.json` (per-path keys); falls back to the global default in Settings.

### Left sidebar (the tree)

- Sections, all collapsible + reorderable: **Favorites**, **Network** (saved connections — color dot = connection state), **Devices** (mounted drives).
- Drag onto a host node to start a `Skiffsync` job.
- Resizable, collapsible (⌘B), icon-only rail mode.

### Theme

- Three modes in Settings: **Light**, **Dark**, **System** (default). System follows the OS live.
- MUI v9 `ThemeProvider`; tokens live in `src/theme/{light,dark}.ts`.
- Honor `prefers-reduced-motion` and `prefers-contrast`.

### Speed targets (these are non-negotiable)

- Cold start to first paint: **< 400 ms**
- Folder listing render (10k entries): **< 100 ms** (virtualized list)
- Folder listing render (100k entries): **< 500 ms**
- Keystroke-to-filter latency: **< 16 ms** (one frame)
- Memory footprint at idle with 5 folders open: **< 150 MB**

To hit those: virtualized list (`@tanstack/react-virtual`), debounced/cancellable directory scans in Rust, never block the UI thread, `notify`-based incremental updates instead of re-listing.

---

## Settings Page

A single `pages/SettingsPage.tsx` route with grouped sections — saved to `app_data_dir()/settings.json` with a Rust-side validator.

> **Familiarity bar**: model the Settings page after macOS Finder → Settings and Windows Explorer → Folder Options. Named sections, never buried more than one click deep, OS-convention vocabulary ("Show hidden files", not invented names).

Shipped sections: Appearance (theme / accent / font size / language), Default view, Sidebar, Saved data, Network, Transfers (Skiffsync), Keyboard (rebindable shortcuts), Advanced (logging / caches / reset / debug utilities) — plus an About header with update check and a macOS-only permissions section. Connections live on their own page.

---

## Status snapshot (as of 0.2.316)

| Phase                                 | Status     | Notes                                                                                                                                              |
| ------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Scaffold & repo hygiene           | ✅ shipped | Branding + CI workflows + public repo                                                                                                              |
| 1 — Core local file explorer          | ✅ shipped | Browse / mkdir / rename / remove / copy; virtualized list; light/dark/system theme; settings page                                                  |
| 1.5 — Preview pane                    | ✅ shipped | All kinds via one `Body` dispatch: image (EXIF auto-orient), text (Prism highlight, search, zoom), markdown, PDF, audio/video, folder summary      |
| 2 — Connection abstraction & SFTP     | ✅ shipped | `russh` backend, registry as Tauri State, Connections page, `sftp://` scheme, ssh-config import, known-hosts TOFU, ssh-agent auth                 |
| 3 — FTP/FTPS + SMB                    | partial    | Plain FTP (0.2.246) + write ops (0.2.247); in-app SMB via pure-Rust `smb2` (0.2.265). Still pending: FTPS, FTP upload via Skiffsync.               |
| 4 — Skiffsync (cpsync-inspired)       | ✅ shipped | Skip-if-unchanged, 9 conflict policies, dry-run, cancel/pause/resume, cross-protocol engine, `cpstamp`/`dedup`/`cprepo`, saved-job templates       |
| 5 — NTFS mount support                | deferred   | Not started — optional, behind cargo feature flag                                                                                                 |
| 6 — Polish, performance, distribution | partial    | Most polish items shipped under 0.2.x (see CHANGELOG). Still open: bundle-size budget audit, auto-updates.                                        |
| 7 — Release pipeline                  | ✅ shipped | `build.yml`, `integration.yml`, `release-official.yml`, `release-beta.yml`, automerge; macOS arm64+x64 / Windows / Linux matrix                     |

The per-patch shipping notes live in [`CHANGELOG.md`](./CHANGELOG.md). When you ship a new patch version, append the entry there.

---

## Shipped phases

Phases 0, 1, 1.5, 2, 4, and 7 are fully shipped — see [`CHANGELOG.md`](./CHANGELOG.md) for the per-patch history and the status table above for what each delivered.

---

## Phase 3 — FTP & SMB/Samba (remaining)

- [ ] **FTPS** (explicit + implicit TLS): suppaftp's `secure` feature
- [ ] **FTP upload** (PreviewPane "Save" + drag-into-Browser): needs `stor` wrapper + Skiffsync cross-engine integration

**Exit criteria:** all three remote protocols feature-equivalent with local: list, read, write, rename, delete, mkdir, stream up/down with progress.

---

## Phase 5 — NTFS Mount Support (optional)

⏳ **Not started.** Optional, gated behind a cargo `ntfs` feature.

- [ ] Detect platform; on macOS auto-detect installed `ntfs-3g` / `mounty` / `macFUSE`
- [ ] On Linux: use `ntfs-3g` via `mount.ntfs-3g`
- [ ] "Mount external volume" UI that shells out with sudo prompt as needed
- [ ] Surface read-only state clearly when no writable driver available
- [ ] On Windows: native — drive letters in sidebar
- [ ] Feature-flag this whole module behind a `cargo` feature `ntfs`

**Exit criteria:** mount and browse an NTFS USB drive on macOS + Linux from inside the app.

---

## Phase 6 — Polish, Performance, Distribution (remaining)

Most polish themes shipped under the 0.2.x run — see [`CHANGELOG.md`](./CHANGELOG.md). Bundle-size baseline in [`BUNDLE_SIZE.md`](./BUNDLE_SIZE.md); accessibility audit in [`A11Y.md`](./A11Y.md). Still open:

- [ ] **Bundle size budget**: < 15 MB on macOS, < 10 MB on Windows
- [ ] **Auto-updates**: Tauri updater pointing at GitHub Releases

---

## Stretch / Future

- [ ] WebDAV protocol
- [ ] S3 / GCS / Azure Blob
- [ ] Built-in terminal pane (xterm.js + PTY) per active connection
- [ ] Diff view between two paths (local vs remote)
- [ ] Encryption-at-rest for saved credentials beyond OS keychain
- [ ] Mobile companion (Tauri 2 mobile target)
- [ ] Plugin API for custom protocols
- [ ] Image rotate / batch-rename / EXIF strip (simple bulk ops)

---

## Backlog (do NOT implement until explicitly requested)

These are tracked here so they don't get lost, but the user has asked that they remain inert until they explicitly say "go work on X".

- [ ] **Cloud storage backends** — first-class support alongside SFTP/FTP/SMB for the major consumer + enterprise clouds:
  - **Google Drive** (OAuth 2.0; Google Drive API v3; `gdrive` Rust crate or REST via `reqwest` + `oauth2` crate).
  - **Microsoft OneDrive** (OAuth 2.0 via Microsoft Graph API; works for personal + Business / SharePoint accounts).
  - **Amazon S3** (AWS SDK or `aws-sdk-s3` crate; bucket + prefix as a virtual root; access key / IAM / SSO auth).
  - **Azure Blob / Azure Files** (`azure_storage` crate; SAS token + connection-string + AAD auth modes).
  - Each should slot into the same `RemoteFs`-style backend abstraction as SFTP so Skiffsync, the Browser pane, the Sidebar Hosts section, and the connection registry treat them uniformly. Auth tokens go through the OS keychain (`keyring` crate) — never stored in plaintext settings.json.
  - Path schemes: `gdrive://<conn_id>/<drive>/<path>`, `onedrive://<conn_id>/<path>`, `s3://<conn_id>/<bucket>/<key>`, `azureblob://<conn_id>/<container>/<blob>`. The frontend's `util/location.ts` `isRemote` helper extends to recognize them.
  - Streaming required — listings can be paginated (S3 `ListObjectsV2`) and large blobs need chunked uploads (S3 multipart, OneDrive resumable, Drive resumable). Reuse the cross-engine's `tokio::io::copy` plumbing.
  - Settings → Connections gets per-cloud "Add" buttons; each pops a provider-specific config form (OAuth flow opens system browser → loopback redirect → token exchange).

- [x] **Unified progress dialogs** _(shipped 0.2.175)_ — one `ProgressWidget` (files counter, rolling-window ETA, pause/cancel) for every long-running op, wired into Transfers + paste/delete flows.

- [x] **Built-in archive viewer (zip / tar / 7z)** _(shipped 0.2.183–0.2.190)_

- [x] **User-customizable theme** _(shipped 0.2.184)_

- [ ] **Bookmark grouping / folders** _(deferred multiple times)_ — needs a `groupId` field + group management UI + drag-vs-group-boundary semantics.

- [x] **Sidebar section reorder** _(shipped 0.2.238)_

- [x] **Image rotate save** _(shipped 0.2.242)_

- [ ] **Streaming `fs_list_dir`** — Rayon-parallel stat is fast enough for 10k entries. Wait until users hit it.

---

## Tech Decisions (committed)

| Decision           | Choice                                                           | Why                                                   |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Shell              | Tauri v2                                                         | Smallest bundles, native webview                      |
| Sidecar            | None (raw template)                                              | All FS/SFTP/FTP/SMB clients have pure-Rust crates     |
| Frontend           | React 19 + TS + MUI v9 + Vite 6                                  | Matches `display-dj` / `sqlui-native`                 |
| Routing            | `HashRouter`                                                     | Required under `tauri://`                             |
| State              | Zustand or React Context (no Redux)                              | Project is browser-shaped                             |
| Virtualization     | `@tanstack/react-virtual`                                        | Smooth at 100k entries                                |
| SFTP               | `russh` + `russh-sftp`                                           | Pure-Rust, no libssh2 C build pain                    |
| FTP                | `suppaftp`                                                       | Async, FTPS-capable, maintained                       |
| SMB                | `smb2`                                                           | Pure-Rust SMB 2/3 — no OS mount, no Samba install                     |
| Watcher            | `notify`                                                         | Cross-platform standard                                               |
| Credentials        | `keyring` crate                                                  | Native Keychain / Credential Manager / Secret Service                 |
| Thumbnail cache    | `rusqlite`                                                       | Tiny, embedded                                                        |
| Trash              | `trash` crate                                                    | Real OS trash on all 3 OSes                           |
| Tests              | Vitest (frontend), `cargo test` (Rust), Playwright (e2e — later) | Matches sister repos                                  |
