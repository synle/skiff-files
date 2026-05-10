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
│ ▾ HOSTS    │  • README.md        3 KB    2026-05-06 ...   Markdown            │      gallery)
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

Optional **two-pane mode** (split vertically) for drag-drop transfers between local ↔ remote, FileZilla-style. Toggle in toolbar or ⌘\.

### View modes (per-folder, persisted)
- **List** — dense rows with sortable columns (default). Keyboard-first.
- **Tile / Grid** — medium thumbnails for image/folder browsing.
- **Gallery** — large thumbnails, single column for media folders.
- **Column (Miller)** — Finder-style cascading panes for deep trees.
- **Tree-only** — pure tree, no file pane (rare).

Each folder remembers its preferred view in a small SQLite per-path table; falls back to the global default in Settings.

### Left sidebar (the tree)
- Three sections, all collapsible: **Favorites**, **Hosts** (your saved connections — color dot = connection state), **Devices** (mounted drives).
- Lazy-load children on expand (no expensive recursive scan up front).
- Drag onto a host node to start a `Skiffsync` job.
- Right-click anywhere to add a favorite, edit a connection, etc.
- Resizable, collapsible (⌘B), persistable width.

### Theme
- Three modes in Settings: **Light**, **Dark**, **System** (default).
- "System" follows the OS — listens to Tauri's `theme-changed` event so it flips live without restart.
- MUI v9 `ThemeProvider` swap; tokens live in `src/theme/{light,dark}.ts`.
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

A single `pages/Settings.tsx` route with grouped sections — saved to `app_data_dir()/settings.json` with a Rust-side validator.

> **Familiarity bar**: model the Settings page after macOS Finder → Settings (Tabs are: General, Tags, Sidebar, Advanced) and Windows Explorer → Folder Options. Group toggles into named sections, never bury them more than one click deep, and stick to the toggle vocabulary users already know from those apps. Don't invent new names for "Show hidden files" or "Show extensions" — match the OS convention so users muscle-memory their way through.

The Phase 1 page already follows this approach (Appearance / Default View / Advanced). Below is the full target surface; sections come online as later phases land.

### Appearance
- Theme: Light / Dark / System
- Accent color (preset palette + custom hex)
- Font size: S / M / L
- Density: Comfortable / Compact (affects row height in list view)
- Show hidden files (dotfiles): on/off — *Finder convention*
- Show file extensions: always / never / when-ambiguous — *Finder/Explorer convention*
- Show full path in title bar: on/off
- Show status bar: on/off
- Reduce motion: on/off (auto-detects)

### Default View
- Default view mode for new folders: List / Tile / Gallery / Column
- Per-folder overrides: keep / forget all
- Default sort: name / size / mtime / kind, asc/desc
- Group folders before files: on/off (Finder default = on)
- Show preview pane on the right: off / images-only / always
- Default zoom for tile/gallery views

### Sidebar
- Sections visible: Favorites, Hosts, Devices (toggle each)
- Show connection-status dots: on/off
- Auto-collapse inactive sections: on/off

### Transfers (Skiffsync)
- Default conflict policy (TeraCopy-style — see Phase 4 for the full action list)
- Default lookback days for "skip if unchanged" heuristic (matches `cpsync`)
- Max parallel transfers
- Bandwidth cap (KB/s, 0 = unlimited)
- Verify after copy (re-stat dest size; optional MD5 for paranoid mode)
- Show conflict dialog: always / only when policy=prompt / never

### Connections
- Reachable from sidebar context menu **and** Settings
- List of saved connections with edit/delete/duplicate/test buttons
- Import from `~/.ssh/config`

### Keyboard
- View, search, and edit shortcuts. Reset to defaults.

### Advanced
- Logging level (off / error / warn / info / debug)
- Clear thumbnail cache
- Reset all settings
- Show app data directory in Files

---

## Status snapshot (as of 0.2.237)

| Phase | Status | Notes |
|---|---|---|
| 0 — Scaffold & repo hygiene | ✅ shipped | Branding + CI workflows + public repo |
| 1 — Core local file explorer | ✅ shipped | Browse / mkdir / rename / remove / copy; virtualized list; light/dark/system theme; settings page |
| 1.5 — Preview pane | ✅ shipped | Image / text / markdown / folder summary at first slice; PDF (0.2.58); audio + video (0.2.38); hex preview for binaries (0.2.202) |
| 2 — Connection abstraction & SFTP | ✅ shipped | `russh` + `russh-sftp` backend, registry as Tauri State, Connections page, sidebar live-host list, `sftp://` scheme + scheme-aware path utils, ssh-config import (0.2.12), known-hosts TOFU (0.2.76), SFTP write side (0.1.10), ssh-agent auth (0.2.85), streaming SHA-256 (0.2.102) |
| 3 — FTP/FTPS + SMB | partial | SMB / Samba via OS-native handler (0.2.141); **FTP / FTPS still pending** (in-app `suppaftp` slice deferred). Real SFTP integration tests still need a docker harness. |
| 4 — Skiffsync (cpsync-inspired) | ✅ shipped | 4a local-to-local: skip-if-unchanged + conflict policies (skip/overwrite/keepBoth) + dry-run + cancel + max-size guard + per-file events. 4b smart-batch policies (overwriteOlder / replaceSmaller / replaceIfSizeDifferent / renameTarget / renameOlderTarget), cross-protocol src/dest, interactive TeraCopy modal w/ apply-to-all, pause/resume, `cpstamp` / `dedup` / `cprepo` modes, saved-job templates persisted to settings.json |
| 5 — NTFS mount support | deferred | Not started — optional, behind cargo feature flag |
| 6 — Polish, performance, distribution | partial | Most polish items shipped under 0.2.x (see below). Bundle-size budget audit, i18n scaffold, auto-updates, crash reporting still open. |
| 7 — Release pipeline | ✅ shipped | `build.yml` + `release-official.yml` + `release-beta.yml` + cleanup workflows; macOS arm64+x64 / Windows / Linux matrix; `/release-official` + `/release-beta` slash commands |

The phase-by-phase shipping notes (every 0.1.x and 0.2.x patch) live in [`CHANGELOG.md`](./CHANGELOG.md). When you ship a new patch version, append the entry there.

---

## 0.2.x polish summary (rounds ~174 → 237)

Headline themes shipped during the 0.2.x polish run:

- **Saved-data parity** across workspaces / selections / searches / sync jobs / bookmarks — every type ships with all five surfaces (sidebar section, drag-reorder via custom MIME, right-click rename/delete, command palette, Settings → Saved data). See ARCHITECTURE.md "Saved-data parity".
- **Filter trio** — kind / tag / recency, with full per-folder persistence.
- **Rebindable shortcuts** — every documented binding rebindable from Settings → Keyboard. Cross-platform Cmd/Ctrl unification via `keyEventToCombo`. Final migration (back/forward, 0.2.236) closed the loop.
- **Finder-style color tags** — set / filter / sort / count / palette / multi-select.
- **Unified `ProgressWidget` + ETA tracker** (0.2.175) + global `OperationsDrawer` (0.2.188) + sync snackbar (0.2.191) — every long-running op surfaces the same widget.
- **Built-in archive viewer** — zip (0.2.183) + tar / tar.gz (0.2.187) + 7z (0.2.190).
- **User-customizable theme palette** — 7-color overrides + Solarized / Dracula / Nord presets (0.2.184).
- **Hex preview for binaries** (0.2.202).
- **Drag-out** to OS via `tauri-plugin-drag` — FileList rows + PreviewPane images.
- **Always-on-top window** toggle.
- **Multi-window settings sync** via `settings:changed` Tauri event + focus reload.
- **CommandPalette** (Cmd+Shift+P) as a comprehensive omnibar across the whole app.
- **Comprehensive right-click coverage** on every clickable surface (file rows, sidebar entries, tab strip, bulk-action bar, etc.).
- **Live FS watcher** (0.2.140) — auto-refresh on disk changes via `notify`.
- **Parallel stat + ctime sort** (0.2.144) — Rayon parallel `list_dir`, fast enough for 10k entries.
- **Tab UX parity** — Bookmark / Duplicate / Close-to-the-left / Cmd+1..9 switching, Chrome / VS Code parity (0.2.232 → 0.2.237).
- **Settings.json power-user buttons** (0.2.235) — open + reload from disk.

---

## Phase 0 — Scaffold & Repo Hygiene

✅ **Shipped.** Goal: working empty Tauri app with the same release rails as `display-dj`, branded "Skiff Files".

- [ ] Copy `tauri-desktop-raw-template` into `~/git/file-explorer` (no sidecar — keeps bundle small)
- [ ] Rename:
  - `package.json#name` → `skiff-files`
  - `src-tauri/Cargo.toml [package].name` → `skiff-files` (keep `[lib].name = "app_lib"`)
  - `src-tauri/tauri.conf.json` → `productName: "Skiff Files"`, `identifier: "com.synle.skiff-files"`, window title, `version: 0.1.0`
  - Workflow `project_name: "Skiff Files"` strings
  - `index.html <title>` and CLAUDE.md / README.md
- [ ] Replace `src-tauri/icons/` (skiff/sailboat icon, generated via `npx tauri icon ./logo512.png`)
- [ ] `LICENSE.md` (MIT)
- [ ] Verify `npm install && npx tauri dev` boots a window
- [ ] Verify `build.yml` PR workflow posts artifact links (matrix: macOS arm64, macOS x64, Windows x64, Linux x64)
- [ ] Initial public GitHub repo `synle/skiff-files`, push `main`

**Exit criteria:** empty branded shell builds + releases on all four targets via `/release-beta`.

---

## Phase 1 — Core Local File Explorer

✅ **Shipped.** Goal: a usable single-pane local file manager.

### Rust (`src-tauri/src/`)
- [ ] `fs/local.rs` — `list_dir`, `stat`, `read_file_chunk`, `write_file`, `mkdir`, `rm`, `rename`, `move_path`, `copy_path` (use `std::fs` + `tokio::fs`; large files via streaming, never `read_to_end`)
- [ ] `fs/types.rs` — shared `Entry { name, path, kind, size, mtime, mode, isSymlink, isHidden }` with `#[serde(rename_all = "camelCase")]`
- [ ] `fs/watch.rs` — `notify` crate for live directory updates, emit `fs:changed` events
- [ ] `fs/icons.rs` — extension → kind mapping for the "Kind" column
- [ ] `commands.rs` — register all `fs_*` commands in `lib.rs#invoke_handler`
- [ ] Path safety: canonicalize, reject `..`-escapes when a sandbox root is set
- [ ] Unit tests for each module

### Frontend (`src/`)
- [ ] `HashRouter` routes — `/`, `/connections`, `/transfers`, `/settings`
- [ ] `pages/Browser.tsx` — split layout: tree sidebar + file list
- [ ] `components/FileList.tsx` — **virtualized** (`@tanstack/react-virtual`), sortable columns, multi-select, keyboard nav (↑↓ Enter Backspace ⌘A Space-to-preview)
- [ ] `components/FileTile.tsx` and `FileGallery.tsx` — alternative view renderers
- [ ] `components/PathBar.tsx` — breadcrumb + editable path field with autocomplete
- [ ] `components/Toolbar.tsx` — back/forward/up/refresh/new-folder/upload/view-mode-toggle
- [ ] `components/Sidebar.tsx` — Favorites / Hosts / Devices, lazy children
- [ ] `components/StatusBar.tsx` — selection count, total size, free space, transfer summary
- [ ] `components/ContextMenu.tsx` — copy, cut, paste, rename, delete, properties, "open in terminal", "reveal in OS"
- [ ] `components/PreviewPane.tsx` — text/image/hex preview for files < 5 MB
- [ ] `theme/` — light + dark MUI themes; `useSystemTheme()` hook listening to Tauri `theme-changed`
- [ ] `state/settings.ts` — Zustand or Context store, persisted via Rust `settings::load/save`
- [ ] Vitest tests for components (mock Tauri `invoke` per template's `src/test/setup.ts`)

**Exit criteria:** can browse local FS on all 3 OSes; rename/move/delete/copy work; watcher updates UI live; theme follows system.

---

## Phase 1.5 — Right-side Preview Pane

✅ **Shipped** (image/text/markdown/folder summary in the first slice; PDF added 0.2.58; audio + video 0.2.38; hex preview for binaries 0.2.202).

Goal: a Finder-style "Get Info" / "Preview" pane that opens to the right of the file list and shows the content of the currently selected file.

- [ ] Toggleable via Toolbar button (eye icon) and `⌘I` keyboard shortcut
- [ ] Persisted preference: Settings → Default View → "Show preview pane" = off / images-only / always
- [ ] **Image preview** — render directly inline; supports png, jpg/jpeg, gif, webp, bmp, svg, avif, heic/heif (heic via Rust-side decode if browser webview can't render natively)
  - Fit-to-pane by default, click to zoom 100%, drag to pan when zoomed
  - Show dimensions + EXIF date/camera if present (read via `kamadak-exif` crate)
- [ ] **Text preview** — first 200 KB rendered with monospace font; longer files show a "show all" link that opens an external editor
- [ ] **Markdown preview** — rendered (toggle to raw)
- [ ] **PDF preview** — embed via webview's native PDF viewer
- [ ] **Audio / video preview** — `<audio>` / `<video>` element, lazy-mounted on first frame
- [ ] **Folder summary** — item count + total size (recursive, cancellable scan)
- [ ] **Properties block** at the top of every preview: size, kind, mtime, mode, full path, "Open with…"
- [ ] Resizable pane (drag the divider); width persisted
- [ ] Cancel any in-flight preview render when selection changes

**Exit criteria:** select a 4 K image, see it in the pane within 200 ms; select a folder, see recursive size within 1 s for 10k entries.

---

## Phase 2 — Connection Abstraction & SFTP

✅ **Shipped.** SFTP backend (`russh` + `russh-sftp`), connection registry as Tauri State, Connections page, Sidebar live-host list, `sftp://<id>/<path>` scheme + scheme-aware `util/location.ts`, SFTP write side (0.1.10), ssh-config import (0.2.12), known-hosts TOFU (0.2.76), ssh-agent auth (0.2.85), streaming SHA-256 for remote files (0.2.102). Real SFTP integration tests still need the docker harness scheduled in Phase 3.

Goal: introduce the remote-FS abstraction; ship SSH/SFTP as the first remote.

### Backend
- [ ] `RemoteFs` async trait, same surface as `fs/local.rs`
- [ ] `fs/registry.rs` — connection pool keyed by `connection_id`; commands accept `connection_id` + path
- [ ] `fs/sftp.rs` — **`russh`** + **`russh-sftp`** (pure-Rust, no libssh2 C dep → smaller bundles, easier cross-compile)
- [ ] Auth: password, private key (with optional passphrase), `ssh-agent`
- [ ] `keychain.rs` — credentials via **`keyring`** crate (Keychain / Credential Manager / Secret Service)
- [ ] `~/.ssh/config` parsing for host autocomplete (`ssh2-config` crate)
- [ ] Streaming download/upload with progress events
- [ ] Reconnect-on-drop with exponential backoff

### Frontend
- [ ] `pages/Connections.tsx` — list/add/edit/delete/test connections (sqlui-native style)
- [ ] `components/ConnectionForm.tsx` — protocol dropdown, host, port, user, auth picker
- [ ] **Two-pane mode**: left = local, right = remote (drag-and-drop between panes)
- [ ] Per-connection icon + colored stripe so users can tell sessions apart

**Exit criteria:** connect to SSH host, browse, upload, download, with credentials remembered securely.

---

## Phase 3 — FTP & SMB/Samba

⏳ **Partial.** SMB / Samba is reachable today via the OS-native handler shortcut (0.2.141) — the in-app `pavao` slice and the full FTP / FTPS path are still pending. Docker-based integration tests for SFTP land here too.

- [ ] **FTP / FTPS**: `suppaftp` with `async-tls`; passive mode default; explicit + implicit TLS
- [ ] **SMB**: `pavao` (pure-Rust SMB2/3) — works without OS-level mounts and without admin rights on Windows
- [ ] Auth UX: anonymous toggle for FTP, workgroup/domain field for SMB
- [ ] Path translation: SMB shares as virtual roots (`smb://host/share/...`)
- [ ] Per-connection bookmarks of recently-used paths
- [ ] Integration tests against `vsftpd` and `samba` containers in CI (`docker-compose.yml` like sqlui-native)

**Exit criteria:** all three remote protocols feature-equivalent with local: list, read, write, rename, delete, mkdir, stream up/down with progress.

---

## Phase 4 — `Skiffsync` (cpsync-inspired smart copy)

✅ **Shipped.** 4a (local-to-local) covers skip-if-unchanged, conflict policies (skip / overwrite / keepBoth), dry-run, cancel between files, max-size guard, per-file events. 4b adds smart-batch policies (overwriteOlder / replaceSmaller / replaceIfSizeDifferent / renameTarget / renameOlderTarget), cross-protocol src/dest via the streaming cross-engine, the interactive TeraCopy modal with apply-to-all, pause/resume, and the `cpstamp` / `dedup` / `cprepo` modes. Saved-job templates persist to `Settings.savedSyncJobs`. Transfers page drives jobs and shows progress bars / current item / ETA.

Goal: port `cpsync`'s spirit to a cross-protocol, cross-platform engine. **The headline feature.**

### Behavior parity with `cpsync`
- [ ] **Skip-if-unchanged**: same-size binaries skip; for text, also compare wordcount + mtime within `lookbackDays`
- [ ] **Pre-scan total size** + abort if over `max_size_gb` (default 1, cap 100)
- [ ] **Progress + ETA**: bytes/sec rolling average, time remaining
- [ ] **Cross-device safe**: fall back from `copy_file_range`/`FICLONE` to plain read+write on EPERM
- [ ] **File→folder** and **folder→folder** modes; preserve relative structure on recursive copy

### New for Skiff Files
- [ ] **Cross-protocol**: source/dest each may be `local`, `sftp`, `ftp`, `smb`
- [ ] **Pause / resume / cancel**
- [ ] **TeraCopy-style conflict resolution dialog** — when a destination file already exists, present a "Destination File Already Exists" sheet with:
  - **Per-file actions** (large primary buttons): Overwrite · Overwrite all · Skip · Skip all · Keep both (rename copied file with `(2)` suffix)
  - **Smart-batch actions** (apply to all remaining conflicts in this job):
    - Overwrite all older files (mtime older than source)
    - Replace all smaller files (size < source)
    - Replace all files if size different
    - Rename all copied files (always keep both)
    - Rename all target files (move existing dest to `name (old).ext`, write new file under original name)
    - Rename all older target files (same as above, but only if the dest is older)
  - Show source vs. dest metadata side-by-side (date, size, "Same date" / "Same size" badges where applicable)
  - Reachable defaults from Settings → Transfers (default conflict policy)
- [ ] **Dry-run** view: would-copy / would-skip / would-conflict / too-big, diff-style panel
- [ ] **Saved sync jobs**: name + source + dest + options, runnable from Transfers page; queue + history
- [ ] **`cpstamp` mode**: copy with timestamp suffix `file.ext.YYYY_MM_DD_HH_MM`
- [ ] **`cprepo` mode**: when source is git, only sync `git ls-files` output (zip-and-ship optional)
- [ ] **`dedup` mode**: scan a folder, MD5+size, move extras to `_recycleBin/`
- [ ] CLI parity: a `--sync` argv path so the binary can run headless from cron

### Implementation
- Engine in `src-tauri/src/sync/` with a `SyncJob` builder
- All progress/ETA via Tauri events `sync:progress`, `sync:done`, `sync:error`
- Frontend `pages/Transfers.tsx` shows queue + per-job progress bars + log tail
- Persist jobs in a small SQLite DB (`rusqlite`) under `app_data_dir()`

**Exit criteria:** sync 5 GB folder local → SFTP → SMB and back; second run completes in seconds via skip-if-unchanged.

---

## Phase 5 — NTFS Mount Support (optional)

⏳ **Not started.** Optional, gated behind a cargo `ntfs` feature.

- [ ] Detect platform; on macOS auto-detect installed `ntfs-3g` / `mounty` / `macFUSE`
- [ ] On Linux: use `ntfs-3g` via `mount.ntfs-3g`
- [ ] "Mount external volume" UI that shells out with sudo prompt as needed
- [ ] Surface read-only state clearly when no writable driver available
- [ ] On Windows: native — drive letters in sidebar
- [ ] Document `macFUSE` install caveat (kernel extension approval) in README
- [ ] Feature-flag this whole module behind a `cargo` feature `ntfs`

**Exit criteria:** mount and browse an NTFS USB drive on macOS + Linux from inside the app.

---

## Phase 6 — Polish, Performance, Distribution

⏳ **Partial.** Most polish themes shipped under the 0.2.x run (see "0.2.x polish summary" above) — virtualized list, keyboard cheatsheet (`?`), tabs, drag-and-drop, OS trash via `trash` crate, configurable shortcuts, recursive find. Bundle-size audit baseline captured in [`BUNDLE_SIZE.md`](./BUNDLE_SIZE.md) (0.2.239 — 6.4 MB stripped, well under the 15 MB target). Opt-in crash reporting shipped 0.2.241. i18n scaffold (English bundle + Language picker) shipped 0.2.243. Accessibility audit baseline + top-tier fixes shipped 0.2.244 (see [`A11Y.md`](./A11Y.md)). SQLite-backed thumbnail cache shipped 0.2.245. Still open: auto-updates via Tauri updater (deferred from this run).

- [ ] **Bundle size budget**: < 15 MB on macOS, < 10 MB on Windows. Audit deps with `cargo bloat`
- [ ] **Large-directory perf**: virtualized list smooth at 100k entries
- [ ] **Search**: in-pane filter (instant) + recursive find (background, cancellable) using `ignore` crate
- [ ] **Quick look / preview**: text, image, hex preview for files < 5 MB; lazy-loaded
- [ ] **Keyboard shortcuts**: configurable, with reset-to-defaults; cheatsheet modal (?)
- [ ] **Tabs**: multiple panes / tabs per window à la Finder
- [ ] **Drag-and-drop**: into the app from the OS, between panes, into host nodes (triggers Skiffsync)
- [ ] **Trash integration**: real OS trash on delete (via `trash` crate), not just `rm`
- [ ] **Thumbnail cache**: SQLite-backed, content-addressed, evictable
- [ ] **i18n scaffold**: English first, structure ready for more
- [ ] **Auto-updates**: Tauri updater pointing at GitHub Releases
- [ ] **Crash reporting**: opt-in, local-only by default
- [ ] **Accessibility**: keyboard-only nav, screen reader labels, focus rings, contrast checks

---

## Phase 7 — Release Pipeline (mirrors `display-dj` / `sqlui-native`)

✅ **Shipped.** `build.yml` + `release-official.yml` + `release-beta.yml` + cleanup workflows are all live. Matrix builds macOS arm64+x64, Windows x64, Linux x64. `/release-official` and `/release-beta` slash commands wrap `gh workflow run`.

- [ ] `build.yml` — `npm test`, `cargo test`, build bundle on all four targets, post PR comment with download links
- [ ] `release-official.yml` — tag `v*` triggers matrix build via `synle/workflows/actions/release/begin-release` + `end-release`
- [ ] `release-beta.yml` — manual `workflow_dispatch` for `release-beta-<date>-<sha>` prereleases
- [ ] `cleanup-artifacts.yml`, `cleanup-pr-artifacts.yml`, `cleanup-releases.yml` — copy from `display-dj`
- [ ] **Code signing**:
  - macOS: Developer ID + notarization (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`)
  - Windows: optional Authenticode (start unsigned, sign once worth it)
  - Linux: AppImage zsync + `.deb` + `.rpm`
- [ ] **Artifact matrix**: dmg/app (macOS arm64+x64), nsis exe/msi (Win x64), deb/AppImage/rpm (Linux x64)
- [ ] Slash commands `/release-beta` and `/release-official` documented in `CLAUDE.md`
- [ ] Optional: Homebrew tap update step (like `sqlui-native`)

**Exit criteria:** `git tag v0.1.0 && git push --tags` produces a signed, notarized release on all four platforms with auto-update wired up.

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


- [x] **Unified progress dialogs for all in-progress operations** *(top priority backlog — first slice in 0.2.175)* — every long-running operation (delete-to-trash, copy, cut/paste, sync jobs) should surface the **same** progress widget so the UX is deterministic. The `ProgressWidget` component + rolling-window ETA tracker shipped in 0.2.175 and is wired into TransfersPage. Snackbar-anchored variant for delete + paste flows + global "operations queue" drawer remain. Spec:
  - **Determinate progress bar** wherever total bytes are known up-front (sync — `bytesDone / bytesTotal`); fall back to indeterminate during the pre-scan.
  - **Files counter** — "N of M files" alongside the bar, regardless of whether the byte count is known. This is the "always-something-deterministic" anchor: even when total bytes are unknown, the user sees how many files are left.
  - **ETA** computed from a rolling 5-second bytes-per-second window. Display as both **time remaining** ("~2 min 14 s") **and absolute completion time** ("done at 3:47 PM"). Switch to "Calculating…" for the first 5 seconds while the rolling window primes.
  - **Current item** label below the bar (the file currently being transferred) so users know it isn't stuck.
  - **Pause / Cancel** controls inline (already in TransfersPage for sync; needs adding to delete + paste flows).
  - Implementation: extract a `ProgressWidget` component that takes `{ filesDone, filesTotal, bytesDone?, bytesTotal?, currentItem?, etaSeconds?, onPause?, onCancel? }`. Consumers: TransfersPage (per-row), a new toast / snackbar-anchored variant for delete + paste, and a global "operations queue" drawer (long-running ops aggregate here so closing the source page doesn't stop the bar). Engine side already emits enough for sync; delete/copy need to grow event streams that mirror `sync:progress`.

- [x] **Built-in archive viewer (zip / tar / 7z)** *(shipped)* — zip (0.2.183) + tar / tar.gz (0.2.187) + 7z (0.2.190). Browse archive contents inline; open files inside the archive into the preview pane; extract individual files via right-click. `zip` + `tar` + `sevenz-rust` crates power the read side.

- [x] **User-customizable theme** *(shipped 0.2.184)* — 7-color palette overrides (primary / secondary / background.default / background.paper / text.primary / text.secondary / accent) + Solarized / Dracula / Nord presets, with side-by-side light/dark preview.

- [ ] **Bookmark grouping / folders** *(deferred multiple times)* — Bookmarks list grows long; visual grouping needs a `groupId` field + group management UI + drag-vs-group-boundary semantics. Has been scoped + skipped repeatedly.

- [x] **Sidebar section reorder** *(shipped 0.2.238)* — `Settings.sidebarSectionOrder` drives each section's CSS `order` inside a flex-column wrapper, so JSX source order stays untouched. Settings → Sidebar gains an arrow-driven reorder list + Reset.

- [x] **Image rotate save** *(shipped 0.2.242)* — `fs_image_rotate(path, degrees)` Tauri command using the `image` crate (default-features=false + JPEG/PNG/GIF/WebP/BMP feature list). PreviewPane gains a Save button next to Rotate-left / Rotate-right. JPEG round-trip is lossy (documented in the tooltip); PNG / GIF / BMP / lossless-WebP are bit-perfect. EXIF-only fast-path for JPEG was scoped out — pixel rotation works uniformly across every format the preview shows.

- [ ] **Streaming `fs_list_dir`** — Rayon-parallel stat (0.2.144) is fast enough for 10k entries. Streaming chunks would help 50k+ folders but adds frontend buffer complexity. Wait until users hit it.

---

## Tech Decisions (committed)

| Decision | Choice | Why |
| --- | --- | --- |
| Shell | Tauri v2 | Smallest bundles, native webview |
| Sidecar | None (raw template) | All FS/SFTP/FTP/SMB clients have pure-Rust crates |
| Frontend | React 19 + TS + MUI v9 + Vite 6 | Matches `display-dj` / `sqlui-native` |
| Routing | `HashRouter` | Required under `tauri://` |
| State | Zustand or React Context (no Redux) | Project is browser-shaped |
| Virtualization | `@tanstack/react-virtual` | Smooth at 100k entries |
| SFTP | `russh` + `russh-sftp` | Pure-Rust, no libssh2 C build pain |
| FTP | `suppaftp` | Async, FTPS-capable, maintained |
| SMB | `pavao` | No OS mount needed, no admin rights |
| Watcher | `notify` | Cross-platform standard |
| Credentials | `keyring` crate | Native Keychain / Credential Manager / Secret Service |
| Settings + Sync DB | `rusqlite` | Tiny, embedded |
| Trash | `trash` crate | Real OS trash on all 3 OSes |
| Tests | Vitest (frontend), `cargo test` (Rust), Playwright (e2e — later) | Matches sister repos |
