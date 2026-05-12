# Skiff Files — Architecture

A map of the major pieces and how they fit together. Pair this with [DEV.md](./DEV.md) when you're getting set up, and [TODO.md](./TODO.md) for the phased roadmap.

---

## High-level shape

```
┌─────────────────────────────────────────────────────────────┐
│  React UI  (src/)                                           │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  pages/        Browser / Connections / Transfers /  │   │
│   │                Settings                              │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │  components/   FileList · Toolbar · PathBar ·        │   │
│   │                Sidebar · Modals · BrowserTabs        │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │  state/        SettingsProvider (Context)            │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │  api/          Typed `invoke` wrappers + event subs  │   │
│   │                (fs · conn · client · sync)           │   │
│   └─────────────────────────────────────────────────────┘   │
│                              ↕  invoke / events             │
│  ╔═══════════════════════════════════════════════════════╗  │
│  ║  Rust  (src-tauri/src/)                                ║  │
│  ║   ┌────────────────────────────────────────────────┐  ║  │
│  ║   │  lib.rs       Tauri builder + command list      │  ║  │
│  ║   │  commands.rs  thin adapters                     │  ║  │
│  ║   ├────────────────────────────────────────────────┤  ║  │
│  ║   │  fs/          local · sftp · registry ·         │  ║  │
│  ║   │               ssh_config · types · icons        │  ║  │
│  ║   ├────────────────────────────────────────────────┤  ║  │
│  ║   │  sync/        plan · engine (local) ·            │  ║  │
│  ║   │               backend · cross_engine ·          │  ║  │
│  ║   │               resolver · stamp · dedup · repo · │  ║  │
│  ║   │               registry (jobs) · types           │  ║  │
│  ║   └────────────────────────────────────────────────┘  ║  │
│  ╚═══════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────┘
```

Two layers, one IPC channel between them.

---

## Frontend (`src/`)

### Routing

`HashRouter` in `main.tsx` so deep links work under the `tauri://` protocol (the file:// loader can't rewrite paths server-side).

| Route | Component |
|---|---|
| `/` | `BrowserTabs` → multiple `Browser` instances under a tab strip |
| `/connections` | SFTP connection manager |
| `/transfers` | Skiffsync job queue + control |
| `/settings` | App preferences |

Two modals are mounted at the App root and surface from any route:

- `ShortcutsModal` — `?` key cheatsheet
- `ConflictModal` — TeraCopy-style sync prompt
- `QuickJump` — Cmd/Ctrl+K palette

### State

**`SettingsProvider`** (`src/state/settings.tsx`) is the single source of truth for user-controlled state. It owns:

- Theme mode + density
- View prefs (default view, per-folder overrides, sort key/direction, per-folder sort overrides)
- Sidebar visibility
- Bookmarks + recent paths + saved tabs (list)
- Sync defaults (conflict policy, max-size, lookback days)

The provider seeds from `localStorage` for instant first paint, then asynchronously rehydrates from disk via `invoke<string>("settings_load")` on mount. Every settings change writes through to BOTH localStorage (hot cache for the next page mount) and disk (durable across reinstalls + dotfile sync).

Per-route ephemeral state lives in the route component. The `Browser` owns navigation history, sort state, search query, primary selection, drag-over state, dialog targets — none of which need to survive route changes.

### Tabs

`BrowserTabs` keeps **all tabs mounted at once** and toggles `display: none` for inactive ones. Switching tabs is instant; no loading state. Each `Browser` instance receives `isActive` and gates its global window listeners (sidebar nav, drag-drop, Delete, Cmd+F) so only the foreground tab responds.

This trades memory for snap-feel — N tabs = N mounted Browsers. With the FileList virtualized, the marginal cost is small.

### IPC layer (`src/api/`)

Four files; one per command family:

- **`fs.ts`** — `fs_*` commands (local filesystem)
- **`conn.ts`** — `conn_*` commands (SFTP)
- **`sync.ts`** — `sync_*` commands + event subscriptions (`onProgress` / `onDone` / `onError` / `onConflict`)
- **`client.ts`** — backend-agnostic dispatch. `listDir(path)`, `mkdir(path)`, `removeOrTrashMany(paths)`, `startSync(src, dest)` etc. all parse `sftp://<id>/<path>` (or `ftp://` / `smb://`) and route to the right command. Components import from here when they shouldn't care which backend a path lives on.

Every command has a typed wrapper here, so command renames are a single-file refactor.

#### Routing model (0.2.271+)

Every fs-verb wrapper in `client.ts` goes through a single `dispatchByLocation<T>(path, spec)` helper. The helper owns the URL → backend decision once; each verb supplies a `local` handler and an optional `remote` handler that receives `(connectionId, remotePath, kind)`. Verbs with partial support (`hashSha256` SFTP-only; `dirSummary` SFTP-only with FTP/SMB getting conservative zeros) declare a `remote` that kind-discriminates internally.

```ts
// Adding a new fs verb:
export async function chmod(path: string, mode: number): Promise<void> {
  return dispatchByLocation(path, {
    local: (p) => fsChmod(p, mode),
    remote: (id, p) => connChmod(id, p, mode),
  });
}
```

Adding a new backend (e.g. WebDAV) means: extend the `Backend` union in `util/location.ts`, extend `parseLocation`, and TypeScript will surface every verb whose `remote` handler needs widening. The pre-0.2.271 shape required hand-editing ~12 verb branches in `client.ts` plus the `Sidebar` scheme picker — the 0.2.270 SMB bug cluster (`mkdir` / `createEmptyFile` / `removeOrTrashMany` / `rename` all missed SMB) was a direct consequence of that.

Future stretch goal: a parallel set of `fs_*_any` Tauri commands that accept the full URL and route in Rust via `resolve_backend`, collapsing the frontend wrappers to one-line `invoke()`s. The dispatcher is the front-half of that refactor; the Rust commands are incremental.

The regression suite in `src/api/client.test.ts` pins every verb's per-backend route — 69 cases covering local + sftp + ftp + smb fan-out and the cross-backend / partial-support edge cases.

### Cross-component coordination — window CustomEvents

When one component needs to fire an action whose handler lives in another (Cmd+Shift+P palette → Browser refresh; Sidebar saved-search click → Browser search state), the dispatcher fires a `skiff:<verb>` window event with a detail payload, the receiver listens via `window.addEventListener`. Saves prop chains and keeps the dispatcher decoupled from the receiver's lifecycle.

- Per-tab actions gated on `isActive` so only the foreground Browser handles `skiff:refresh`.
- Cross-tab actions unghosted (`skiff:refresh-all`).
- Payloads accept both bare strings (legacy) and `{id, ...}` objects (new) for back-compat — adding a flag like `dryRun` doesn't break callers.
- Receivers: `Browser` (`skiff:refresh`, `skiff:new-folder`, `skiff:tag-selection`, `skiff:restore-selection`, `skiff:run-saved-search`, `skiff:refresh-all`); `BrowserTabs` (`skiff:new-tab`, `skiff:restore-closed-tab`, `skiff:restore-workspace`, `skiff:append-workspace`); `TransfersPage` (`skiff:run-sync-job`).

Dispatch site: `App.tsx::buildCommandActions`.

### Saved-data parity (workspaces / selections / searches / sync jobs / bookmarks)

Every user-curated saved-data type ships with the same five surfaces — shipping any subset feels half-finished. When adding a new type, mirror this exactly:

1. Persist in `Settings.<key>` (capped LRU; oldest entries dropped on overflow).
2. **Sidebar section** — click-to-use, right-click rename / delete, drag-reorder via custom MIME (`application/x-skiff-<key>`), Sort A→Z when count ≥ 5, visibility toggle in Settings → Sidebar.
3. **Cmd+Shift+P palette actions** (sometimes paired — workspaces have replace + append; sync jobs have run + dry-run).
4. **Settings → Saved data** rename / delete management block.
5. **Cross-component event** (`skiff:run-X`, `skiff:restore-X`) so the palette + sidebar share the same execution path.

`Sidebar.tsx`'s Workspaces / Searches / Selections / Sync jobs / Bookmarks blocks are near-clones; `BulkActionBar` + the right-click context menus are the typical create surfaces.

---

## Rust (`src-tauri/src/`)

### Command surface (`commands.rs` + `lib.rs`)

`commands.rs` is the only file with `#[tauri::command]` annotations. Each command is a thin adapter that:

1. Parses string args from the frontend.
2. Hands them to a real implementation in `fs/` or `sync/`.
3. Returns `FsResult<T>` (alias for `Result<T, String>` — Tauri serializes the `Display` of error variants).

`lib.rs` holds the `tauri::Builder` + the `invoke_handler!` macro list. Adding a new command means three small edits: impl + adapter + registration + frontend wrapper.

### Filesystem layer (`src-tauri/src/fs/`)

| File | Responsibility |
|---|---|
| `types.rs` | Shared `Entry`, `FileKind`, `ListOptions` (camelCase via Serde) |
| `icons.rs` | Extension → `FileKind` table (purely informational, never used for security decisions) |
| `local.rs` | Sync `std::fs` operations: `list_dir`, `stat`, `mkdir`, `rename`, `remove`, `read_text`, `read_base64`, `dir_summary`, `find` |
| `sftp.rs` | Async SFTP via `russh` + `russh-sftp`. `SftpClient::connect` + the same surface as `local.rs`, plus `open_read` / `open_write` for streaming |
| `registry.rs` | Live-connection map (`Mutex<HashMap<id, Connection>>`) held as Tauri State |
| `ssh_config.rs` | Permissive `~/.ssh/config` parser — `Host` blocks with `HostName` / `User` / `Port` / `IdentityFile` |

The local + SFTP backends expose intentionally similar shapes so the sync engine can dispatch over both with a thin enum.

### Sync engine (`src-tauri/src/sync/`)

Two engines because the local + cross-protocol paths benefit from different runtime models.

#### Local engine (`engine.rs` + `plan.rs`)

Synchronous. Walks a tree with `std::fs`, builds a `PlannedFile[]`, then iterates with the kernel-accelerated copy path (`copy_file_range` / `clonefile`) and EPERM fallback to `read + write`. Handles every conflict policy + the resolver-hub Prompt protocol.

Used by `sync_start_local` and `sync_start_repo`.

#### Cross-protocol engine (`cross_engine.rs` + `backend.rs`)

Async (tokio). The `Backend` enum (`Local | Sftp(Arc<SftpClient>)`) abstracts metadata / read / write / mkdir_p / rename / streaming `copy_file`. The cross executor mirrors the local engine's loop shape but every IO is `await`-ed; per-file copies stream via `tokio::io::copy` so multi-GB files work without buffering.

Used by `sync_start_cross` (any pair of `local` ↔ `sftp` endpoints; pure local-to-local short-circuits to the local engine for the kernel-accelerated path).

#### Conflict resolution

`types::ConflictPolicy` has 9 variants:

- **Pre-decided per-file**: `skip`, `overwrite`, `keepBoth`
- **Smart-batch (TeraCopy parity)**: `overwriteOlder`, `replaceSmaller`, `replaceIfSizeDifferent`, `renameTarget`, `renameOlderTarget`
- **Interactive**: `prompt`

The Prompt protocol:

```
engine -> emits sync:conflict event with conflict_id
engine -> parks on ResolverHub::wait_for(conflict_id)
frontend -> shows ConflictModal
user -> picks Overwrite / Skip / Keep both / Cancel
       (or Apply-all variants — closure caches sticky)
frontend -> sync_resolve_conflict(jobId, conflictId, decision)
ResolverHub -> wakes wait_for; engine continues with the answer
```

Cancel breaks the wait. Apply-to-all caches the decision in the per-job closure so subsequent conflicts skip the modal entirely.

#### Job lifecycle (`registry.rs`)

`JobRegistry` tracks every running / paused / completed job. Holds the `CancelToken` per job (which carries both cancel + pause flags). `sync_pause` / `sync_resume` flip the pause flag; the executor's `wait_if_paused()` polls every 100 ms so a Cancel-while-paused unblocks responsively.

#### `cpsync` family ports (`stamp.rs`, `dedup.rs`, `repo.rs`)

Ports of the user's bash `cpstamp` / `dedup` / `cprepo` flows:

- **`cpstamp`** — single-file copy with `YYYY_MM_DD_HH_MM` suffix.
- **`dedup`** — recursive scan, group by size, MD5-compare same-size groups, move duplicates to `<root>/_recycleBin/`. Idempotent.
- **`cprepo`** — uses `git ls-files -z` to plan, then runs through the regular executor. Skips untracked + ignored files (no `node_modules`).

### Tauri state

Three globals are `manage`d at builder time:

- `Arc<Registry>` — live SFTP connections
- `Arc<JobRegistry>` — sync job tracking
- `Arc<ResolverHub>` — conflict prompt waiters

Async commands access these via `State<'_, Arc<T>>`. They're Arc'd so closures can clone references freely.

---

## Cross-cutting concerns

### Versioning

`src-tauri/tauri.conf.json#version` is the only source of truth. `build.rs` exposes it as `APP_VERSION` so Rust does `env!("APP_VERSION")`. Dev builds append `[DEV]`; CI release builds set `TAURI_RELEASE=true` for a clean string.

### Path scheme

The frontend uses one address-bar form for everything:

- Local: `/Users/syle/git` or `C:\\Users\\syle`
- Remote: `sftp://<connection_id>/<remote-path>`

`util/location.parseLocation` splits this into `{ backend, remotePath }`. Components and `api/client.ts` are uniformly scheme-aware so users can drag-drop / copy-paste / bookmark across protocols without thinking about it.

### Concurrency model

- Frontend renders on React 19's concurrent renderer.
- Rust commands run on Tauri's command worker pool. Each `#[tauri::command]` is independent.
- Sync jobs spawn their own `std::thread` (local engine) or build a per-job tokio runtime (cross engine). The work pinned to a thread is intentional — std::fs is blocking and we don't want to pin the tokio reactor.
- The `ResolverHub` uses a `Mutex<HashMap>` + `Condvar` so engine threads can park without spinning.

### Settings persistence

```
SettingsProvider mount
  ├── seed = loadSettings()         (sync, localStorage)
  ├── async loadSettingsFromDisk()  (settings_load Tauri cmd)
  └── setSettings(disk version)     if non-null

settings change
  ├── saveSettings(...)             (localStorage hot cache)
  └── saveSettingsToDisk(...)       (settings_save → atomic temp+rename)
```

This double-write means: tests + browser-dev mode see localStorage, the real app sees disk, and we never lose state.

### Where IO lives

| Lives in | What |
|---|---|
| Frontend | UI state, virtualization, modal queueing, validation that's safe to redo (path canonicalization is local-only safety net) |
| Rust | Anything that touches the OS or network — no exceptions |

The frontend never does fs APIs directly even when a browser API exists, because tests would diverge from production behavior.

---

## Why these choices

**Tauri v2** — smallest desktop bundle (~10–15 MB). React frontend keeps the iteration loop fast; Rust backend keeps memory usage low and lets us pull pure-Rust crates for every protocol (`russh` has no libssh2 C dep).

**No sidecar process** — every protocol library we need is in pure Rust. A separate Node sidecar would balloon installer size and add a process boundary we don't need.

**Two sync engines** instead of one — the local engine's kernel-accelerated copy is meaningful on macOS (clonefile is near-instantaneous). The cross engine has to be async, but there's no value in giving up `clonefile` for purely local jobs. The `startSync` dispatcher in `client.ts` picks the right one transparently.

**Settings as opaque JSON** on the Rust side — the schema is owned by the frontend; the Rust command is a string read/write. This means schema changes don't ripple across the IPC boundary.

**`HashRouter`** — needed under `tauri://`. It's not pretty but it's mechanical and works in dev (browser preview) too.

**Settings + state in `localStorage` first, then disk** — the rehydrate-after-mount pattern keeps the UI snappy without sacrificing durability.

---

## Component dependency rules of thumb

- **`util/` is pure.** No imports from `api/` / `state/` / `components/`. Everything in `util/` should be unit-testable without React.
- **`api/` doesn't render.** Pure functions returning Promises.
- **`components/` doesn't fetch.** Receive data via props, dispatch actions via callbacks.
- **`pages/` orchestrate.** They own state + plumb between `api/` and `components/`. Modals are an exception — they self-contain their flow.
- **`state/settings.tsx` is the only Context.** Don't add more globals; thread props or use events instead.

Stick to these and the codebase stays testable + comprehensible regardless of how many features pile on.
