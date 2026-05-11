# Skiff Files — Developer Guide

Hands-on guide for getting Skiff Files running locally, the day-to-day commands you'll use, and where to look when something breaks.

For a high-level map of the codebase see [ARCHITECTURE.md](./ARCHITECTURE.md). For the phased roadmap see [TODO.md](./TODO.md). For the AI-assistant guidance file see [CLAUDE.md](./CLAUDE.md).

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | `fnm` / `nvm` to pin |
| npm | 10+ | Ships with Node |
| Rust | stable | `rustup default stable` |
| Tauri prerequisites | — | See [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |

Per-platform extras Tauri needs:

- **macOS** — Xcode Command Line Tools (`xcode-select --install`)
- **Windows** — Microsoft C++ Build Tools, WebView2 (preinstalled on Win11)
- **Linux** — `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev libssl-dev`

---

## First-time setup

```bash
git clone git@github.com:synle/skiff-files.git
cd skiff-files
npm install
npx tauri dev          # full desktop app (Rust + Vite together)
```

The first `tauri dev` builds the Rust crate from scratch — expect 3–10 minutes depending on machine. Subsequent runs reuse the `target/` cache and start in seconds.

---

## Day-to-day commands

```bash
# Frontend only (browser preview at http://localhost:1420 — useful for fast iteration on UI)
npm run dev

# Full desktop app in dev mode
npx tauri dev

# Type-check the frontend (no emit; runs in CI on every push)
npm run typecheck

# Frontend tests (Vitest + React Testing Library, jsdom environment)
npm test                 # one-shot
npm run test:watch       # watch mode while iterating

# Rust tests
cd src-tauri && cargo test

# Remote-backend integration suite (SFTP / FTP / SMB against a
# Docker-compose stack — see "Remote backends in Docker" below).
# Without SKIFF_INTEGRATION=1 every case is skipped, so this is
# safe to run anywhere.
SKIFF_INTEGRATION=1 cargo test --test remote_integration

# Production frontend build (just the bundle, not the desktop wrapper)
npm run build

# Production desktop build — produces .dmg / .exe / .deb / .AppImage
npm run tauri:build
```

---

## Project layout

```
.
├── src/                          # React + TS frontend
│   ├── api/                      # Typed wrappers around `invoke` Tauri commands
│   │   ├── fs.ts                 # Local filesystem ops
│   │   ├── conn.ts               # SFTP connections
│   │   ├── client.ts             # Backend-agnostic dispatch (local vs sftp://)
│   │   └── sync.ts               # Skiffsync engine commands + event helpers
│   ├── components/               # Shared UI (FileList, Sidebar, Toolbar, modals…)
│   ├── pages/                    # Route-level (Browser, Settings, Connections, Transfers)
│   ├── state/settings.tsx        # SettingsProvider + persistence
│   ├── theme/                    # Light/dark/system MUI themes
│   ├── util/                     # Pure helpers (format, location, autocomplete, mime, etc.)
│   ├── test/setup.ts             # Vitest setup; mocks Tauri APIs
│   ├── App.tsx                   # Root layout + route table
│   └── main.tsx                  # React bootstrap (HashRouter, providers)
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri builder + command registration
│   │   ├── commands.rs           # Tauri command adapters (`#[tauri::command]`)
│   │   ├── fs/
│   │   │   ├── local.rs          # Local fs primitives
│   │   │   ├── sftp.rs           # SFTP backend (russh + russh-sftp)
│   │   │   ├── registry.rs       # Live-connection map (Mutex<HashMap>)
│   │   │   ├── ssh_config.rs     # ~/.ssh/config parser
│   │   │   ├── icons.rs          # Extension → kind table
│   │   │   └── types.rs          # Shared Entry / FileKind / ListOptions
│   │   └── sync/
│   │       ├── plan.rs           # Local pre-scan walker
│   │       ├── engine.rs         # Local-only executor (sync std::fs path)
│   │       ├── backend.rs        # Backend enum (Local / Sftp) + streaming helpers
│   │       ├── cross_engine.rs   # Async cross-protocol executor
│   │       ├── stamp.rs          # cpstamp single-file timestamp copy
│   │       ├── dedup.rs          # md5+size duplicate scan
│   │       ├── repo.rs           # cprepo (git ls-files only)
│   │       ├── resolver.rs       # Conflict-prompt hub (Condvar)
│   │       ├── registry.rs       # Job lifecycle + cancel/pause tokens
│   │       └── types.rs          # ConflictPolicy, JobOptions, Progress, Summary
│   ├── build.rs                  # Exposes APP_VERSION at compile time
│   ├── Cargo.toml
│   └── tauri.conf.json           # Source of truth for app version + window config
├── .github/workflows/            # CI / release pipelines
└── docs (TODO.md, CLAUDE.md, ARCHITECTURE.md, DEV.md)
```

---

## How a Tauri command flows through the stack

This is the most common mental model you need:

1. **Frontend** calls `invoke<T>("fs_list_dir", { path, options })` via the wrapper in `src/api/fs.ts`.
2. **Tauri** routes the string command name to the matching `#[tauri::command] fn fs_list_dir(...)` in `src-tauri/src/commands.rs`.
3. **commands.rs** is a thin adapter — it parses arguments and delegates to a real impl in `src-tauri/src/fs/` or `src-tauri/src/sync/`.
4. **Result** serializes back through Tauri (Serde handles `#[serde(rename_all = "camelCase")]`).

When you add a new command:

- Define the impl in the right module under `fs/` or `sync/`.
- Add a thin `#[tauri::command]` adapter to `commands.rs`.
- Register it in the `invoke_handler!` list in `lib.rs`.
- Add a typed wrapper to `src/api/*.ts`.
- Mock it in `src/test/setup.ts` so component tests don't blow up.

---

## Versioning

The single source of truth is `src-tauri/tauri.conf.json` → `version`. `build.rs` reads it at compile time and exposes it as the `APP_VERSION` env var, so Rust code does `env!("APP_VERSION")` without depending on `Cargo.toml`'s version.

Dev builds append `[DEV]`; CI release builds set `TAURI_RELEASE=true` for a clean version string.

`package.json` and `src-tauri/Cargo.toml` versions are intentionally NOT used by the app. Leave them at `0.1.0` / `0.0.0`.

---

## Cutting a release

```bash
# Bump the version (update tauri.conf.json), commit on main
git tag v0.2.X
git push origin v0.2.X
```

The tag push triggers `.github/workflows/release-official.yml`:

- Matrix build on macOS arm64+x64, Windows x64, Linux x64
- Each platform produces a Tauri bundle (.dmg / .app / .exe / .msi / .deb / .AppImage / .rpm)
- All bundles get attached to a draft GitHub Release named `Skiff Files v<tag>`

`release-beta.yml` does the same shape but as a manual workflow_dispatch (takes an optional commit SHA) for off-tag prereleases.

---

## Testing tips

- **Frontend tests use jsdom**, which doesn't lay things out. The `@tanstack/react-virtual` virtualizer needs a coaxed `getBoundingClientRect`; see the shim in `FileList.test.tsx` and `App.test.tsx`. Copy it for any test that mounts a Browser.
- **Tauri APIs are mocked** in `src/test/setup.ts`. When you add a new `invoke` command, add its mock there or your tests will see `null`.
- **Rust unit tests** that touch the filesystem use a `uniq()` helper to generate per-test temp dirs (sequence + nanos) so parallel test runs don't collide.
- **SFTP / FTP / SMB integration tests** run against the docker-compose stack in [`docker/docker-compose.yml`](docker/docker-compose.yml). Gated on `SKIFF_INTEGRATION=1` so a `cargo test` without docker still passes. CI runs the suite in [`.github/workflows/integration.yml`](.github/workflows/integration.yml). See "Remote backends in Docker" below for the full setup.

---

## Remote backends in Docker

The compose stack spins up three real servers bound to 127.0.0.1 — useful for debugging a tricky `list_dir` regression without standing up a NAS, and required by the `cargo test --test remote_integration` suite.

```bash
# Bring the stack up (detached). Ports + creds in docker/docker-compose.yml.
docker compose -f docker/docker-compose.yml up -d

# Sanity-check
docker compose -f docker/docker-compose.yml ps

# Connect from the app: in the address bar
#   sftp://127.0.0.1:2222     → user testuser, password skiffpass
#   ftp://127.0.0.1:2121      → user testuser, password skiffpass
#   smb://127.0.0.1:1445      → user testuser, password skiffpass, share "testshare"
# RemoteConnectDialog will prompt for the password the first time.

# Run the integration suite (each test reconnects with retries so a
# cold-start stack is fine).
SKIFF_INTEGRATION=1 cd src-tauri && cargo test --test remote_integration -- --test-threads=1

# Tear down + drop the volumes (resets state for the next run).
docker compose -f docker/docker-compose.yml down -v
```

What the suite covers today:

- **Per-backend round-trip** (write → list → read → rename → delete) for SFTP, FTP, SMB.
- **Cross-backend transfers** (SFTP→SMB, FTP→SMB, SMB→SFTP) — read from source, write to destination, verify bytes match. Same primitive `Skiffsync` uses; this catches breakage in any backend's read or write path.

Things deliberately not covered yet (room to grow): Skiffsync's resume / progress logic, FTP-over-TLS (FTPS), SMB Kerberos auth, large-file streaming, the JS-layer copy/cut/paste UX (those need Playwright or similar — out of scope for this slice).

If a test fails locally, dump container logs first — most flakes are docker-startup races:

```bash
docker logs skiff-sftp
docker logs skiff-ftp
docker logs skiff-smb
```

---

## Common gotchas

- **MUI v9 dropped `inputProps`** — use `slotProps={{ htmlInput: { ... } }}` or `slotProps={{ input: { ... } }}`. Legacy MUI v8 docs lie.
- **`@mui/icons-material` barrel imports** trip EMFILE on CI. Always import deep: `import Folder from "@mui/icons-material/Folder"`. We had to fix this once already (see `97a9fa0`).
- **Zombie vitest workers** can stack up if a test loops infinitely. `pkill -9 -f vitest` clears them.
- **Settings persist via localStorage** in tests + browser dev mode, and `app_data_dir/settings.json` in the real Tauri runtime. Tests that mutate settings should `localStorage.clear()` in `beforeEach` to avoid leak between bodies.

---

## Footguns — bugs that have already bitten us

Add a regression test when you touch the related area.

- **Don't use `window.alert` / `window.confirm` / `window.prompt` in Tauri.** The webview suppresses them in some configurations — gates like `if (!window.confirm(…)) return;` silently no-op, so destructive actions appeared dead. Use a modal dialog (`ConfirmDialog`, `RenameDialog`, `NewEntryDialog`). Pattern: lift `open` + `onConfirm` into the parent's state.

- **Don't define React components inline inside another component.** A component declared inside another component's body is a fresh type on every render — React tears down + remounts the subtree each parent render. Click handlers and inputs silently break. Always declare reusable components at module scope (or memoize with a stable ref). The Sidebar's `SectionHeader` regression was exactly this.

- **HashRouter + StrictMode + nested conditional `<Routes>` had a render-loop bug.** Clicking a sidebar nav link flipped the URL to `/settings`, but a render later something flipped it back. Fixed by ditching react-router for top-level page switching and using a `Page` discriminated union in `App.tsx`. If you re-introduce react-router, write a test that asserts `useLocation().pathname` is stable for one tick after `navigate()` returns.

- **Skiffsync's `start_local` / `start_cross` returns once the job is QUEUED, not done.** Don't `await startSync(...)` then immediately `refresh()` — the file isn't on disk yet. Use synchronous `fs_copy_recursive` / `fs_copy_file` for one-shot duplicate flows; reserve Skiffsync for long transfers where progress events drive the UI.

- **Find-in-subfolders gating.** When the recursive-find toggle is on but the search input is blank, `findResults` is `[]`. Don't substitute that for the listing — it'll show "Empty folder" out of the blue. Require both the toggle AND a non-empty query before swapping in find results.

- **Page container layout.** Route pages (`SettingsPage`, `TransfersPage`, `ConnectionsPage`) sit inside a flex-column main area. Outer Box MUST set `flex: 1` (not `maxWidth`) or the page won't fill the available width. Use an inner `Box maxWidth=… mx="auto"` for content centering.

- **MUI theme: never spread typography / transitions from a baked theme.** `createTheme` bakes per-variant pixel sizes (body1, h1, …) and per-component transition strings at construction time. `createTheme({ ...base, typography: { ...base.typography, fontSize: 16 } })` does NOT rescale variants. Always recompose from input options in a single `createTheme(...)` call. Also override `MuiCssBaseline.html.fontSize` so non-Typography text (buttons, MenuItems) picks up the scale.

- **Keyboard shortcuts: `e.key` is layout-dependent.** macOS US Shift+. emits `>` not `.`. Bindings like Cmd+Shift+. silently never fire if you check `e.key === "."`. Use `e.code` (layout-independent) for symbol keys, or accept multiple variants (`. > Period`).

- **Multi-window state isolation.** Each window holds its own React tree + settings cache. Pattern: emit a `settings:changed` Tauri event after every persisted save, listen in every window + reload from disk; reload on `window` focus as a safety net. See `commands.rs::settings_save` + `App.tsx`'s settings-sync effect.

- **Verify Settings controls in the running app, not just typecheck + tests.** Several Settings dropdowns / toggles (font size, density, reduce motion, status bar, view modes) had wired-up `onChange` + persisted state, but the visual didn't change because the consumer read the wrong shape, the layer between settings and render was misconfigured, or the prop wasn't threaded down. The smoke test is "flip it in `npx tauri dev` and watch the pixels change."

- **Right-click context menu consistency.** Every clickable surface that has actions needs a context-menu equivalent — users muscle-memory right-click everywhere. Pattern: small presentational `*ContextMenu` component (`SidebarContextMenu`, `EntryContextMenu`); the parent supplies the action list per-row, mirroring inline buttons. Keep disabled-state in sync (e.g. "Move up" disabled at index 0).

- **Cosmetic feedback for the right-click target.** When a context menu opens, the user needs to see WHICH row it acts on. Track `contextMenuPath` separately from `selected` / `focusedIdx`, draw a non-state inset outline, clear when the menu closes. See FileList's three-way precedence: drag-over > context-target > focused.

- **Hardcoded affordance lists need an escape hatch.** Pair every hardcoded list with a `hidden<Thing>: string[]` setting + an inline hide affordance. Same for sections themselves (a hover-visible × icon on each section header beats burying visibility in Settings → Sidebar).

- **Always virtualize list-like surfaces.** Power users have 10k-entry folders. Tile / Gallery / Column views shipped non-virtualized at 0.2.132 and were sluggish at 1k+ entries. Pattern for grids: ResizeObserver on the parent, compute `cols = floor(width / cellWidth)`, virtualize rows with `useVirtualizer`, render `cols` cells per virtual row.

- **macOS TCC sandbox makes parts of $HOME unreadable.** `~/.Trash` returns "Operation not permitted" from `read_dir` without Full Disk Access. Other hot spots: `~/Library/Mail`, `~/Pictures/Photos Library.photoslibrary`, `~/Library/Messages`. Pattern: detect at command-add time, route through `fs_open_with_default` so the OS native file manager handles it. Windows' Recycle Bin isn't a real fs path — `fs_trash_path` returns `null` so the favorite hides itself.

- **Async-vs-sync mismatch in user-facing flows.** "Duplicate" expects the file on disk + visible in the listing immediately. Skiffsync returns when queued, racing the refresh. For one-shot user actions, prefer synchronous Tauri commands (`fs_copy_recursive`).

- **Continuous gestures must NOT call `update()` per mousemove.** At 60 fps the persist effect fires `settings_save`, broadcasts `settings:changed`, our listener reloads from disk + calls `setSettings(fromDisk)`. A stale disk read can land mid-drag and snap the value back (sidebar / preview-pane width "snapping back" — 0.2.167/0.2.168). **Pattern: drag-then-commit.** Track local `dragWidth: number | null` in the dragging component; mousemove updates local only; render uses `dragWidth ?? settings.persistedValue`; mouseup calls `update()` ONCE with the final value, then clears local state.

- **Saved-data UX needs all five surfaces or none.** See ARCHITECTURE.md "Saved-data parity" — Sidebar + drag-reorder + right-click + palette + Settings → Saved data. Plan all five before merging the first slice.

- **Rebindable shortcuts go through `matchesCombo(e, activeCombo(actionId, defaultCombo, settings.shortcutOverrides))`.** Don't write `e.key === "x"` in new keybinding handlers — it bakes in a default the user can't change. Add an `actionId` + `defaultCombo` to `SHORTCUT_GROUPS` and use the lookup. Universal conventions (F5, F1, Cmd+←) stay as hardcoded aliases in addition to the rebindable path. `keyEventToCombo` treats `metaKey || ctrlKey` as a single platform-neutral `cmd` so Cmd+K on macOS matches Ctrl+K on Linux.

- **Cross-component actions go through window CustomEvents, not prop-drilling.** See ARCHITECTURE.md "Cross-component coordination" for the convention.

- **State sync that round-trips THROUGH a side-channel must dedup by VALUE, not by reference.** Bit Skiff hard 0.2.135 → 0.2.138 (the view-mode oscillation). Shape: setState → useEffect persists to side-channel → own listener fires → reload payload + setState(payload) — payload is a fresh object reference even when values are identical → React sees new ref → persist effect re-arms → infinite loop. **Fix lives at the writer**: dedup the persist effect with a value comparison (`JSON.stringify` against a ref of the last successfully-persisted value) so an equal-by-value setState becomes a no-op at the persist boundary. A reader-side equality check is a useful second guard but not sufficient — by the time the reader compares, the writer's setState has already produced a new object ref one tick earlier. Pin a regression test that calls setState with an equal-by-value but new-by-reference object and asserts the persist call count stays at zero. See `settings.test.tsx::"persist effect dedup (regression for the cross-window loop)"`. *Lesson: when a fix doesn't help, change the layer of the model you're poking at — layout → render-timing → state-flow each represent a different layer; cycling through them as hypotheses converges faster than tweaking the same layer twice.*

### Checklist when adding any UI affordance

1. **Smoke test in the running app.** Typecheck + Vitest pass on bindings that don't actually flow through. `npx tauri dev`, flip the control, verify pixels change.
2. **Match key bindings to the OS layout.** `e.code` for symbol keys, multiple `e.key` variants for layout differences.
3. **Right-click anywhere should reveal an action menu** that mirrors inline buttons with the same disabled-state logic.
4. **Show which row a context menu acts on.** Cosmetic outline ≠ selection state.
5. **Pair hardcoded lists with a hide-mechanism.** `hidden<Thing>: string[]` + inline × icon + Settings → restore-all.
6. **Plan for multi-window from the start.** Settings sync via Tauri event broadcast on save + focus reload.
7. **Virtualize anything list-shaped** — including grids.
8. **Detect OS sandbox boundaries** and route to OS-native handlers when in-app reads fail.
9. **Pick sync vs async transports per UX expectation.** Sync command for "do X then refresh"; async engine + progress events for long-running transfers.
10. **End-to-end test flow per fix.** Assert the *visible behavior*, not just the state mutation.

---

## Slash commands

Defined under your `~/.claude/` config:

- `/release-official` — kicks off the official release flow interactively.
- `/release-beta` — beta release.
- `/commit` — Claude-driven commit on the current branch.
- `/draft-pr` / `/create-pr` — PR creation.

These wrap the `gh` CLI; you can always invoke `gh workflow run release-official.yml` directly.

---

## Where to look when…

| Symptom | First place to look |
|---|---|
| `cargo build` fails to find a crate | `src-tauri/Cargo.toml`, then `cargo update` |
| Frontend imports break after adding a setting | `src/state/settings.tsx` — DEFAULTS must include the new key, and any file listing settings (e.g. `SettingsPage.tsx`) needs updating |
| A new Tauri command "doesn't exist" at runtime | `src-tauri/src/lib.rs` `invoke_handler!` list |
| Cross-protocol sync misbehaves | `src-tauri/src/sync/cross_engine.rs` `process_one` is the per-file dispatch |
| Test can't see DOM the user would see | jsdom layout shim in the relevant test (see FileList.test.tsx) |
| Build green locally, red on Windows CI | usually a path-separator or icon-import issue; check the failing step's log via `gh run view <id> --log-failed` |

---

## Style + conventions

- All Rust structs sent to the frontend use `#[serde(rename_all = "camelCase")]`.
- Tauri commands are `snake_case` in Rust, called with `snake_case` strings from `invoke()`.
- Frontend parameter objects use `camelCase` (Serde converts).
- Always add tests for new code: React components → `*.test.tsx`, Rust modules → `#[cfg(test)] mod tests` block.
- Pure helpers in `util/` — keep them sync + side-effect-free so they're trivially testable.
- Comments explain the *why* (race conditions, platform quirks, design trade-offs), not the *what*.
