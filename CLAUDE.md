# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**Skiff Files** — a fast, cross-platform desktop file explorer for Windows / macOS / Linux. Built with **Tauri v2** (Rust backend) + **React 19** (TypeScript) + **MUI v9** + **Vite 6**. No sidecar — all backend logic lives in the Rust crate, which keeps bundles small and avoids a Node runtime.

Supports local FS, SSH/SFTP, FTP/FTPS, SMB/Samba, and (optional) NTFS mounts. Headline feature is **Skiffsync**, a `cpsync`-inspired smart-copy engine that skips unchanged files across protocols.

## Companion docs

Read these first when picking up new work:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — high-level map of the major modules, how IPC flows, why we split the sync engine in two, conventions per layer.
- [`DEV.md`](./DEV.md) — local setup, day-to-day commands, project layout, common gotchas, where-to-look table.
- [`TODO.md`](./TODO.md) — phased implementation plan + the deferred backlog. Always consult before starting a new feature.

## Build commands

```bash
npm install              # JS dependencies
npm run dev              # Vite dev server only (browser mode)
npx tauri dev            # Full desktop app in dev mode
npm run build            # Production frontend build
npx tauri build          # Production desktop build
npm test                 # Vitest (run once)
npm run test:watch       # Vitest watch mode
npm run typecheck        # tsc --noEmit
cd src-tauri && cargo test  # Rust tests
```

## Architecture

Two layers, talking via `invoke()`:

- **`src/` (React + TS)** — UI built with MUI v9. Routes via React Router (`HashRouter` so deep links work under `tauri://`). The `pages/` directory holds route-level components (`Browser`, `SettingsPage`); `components/` holds shared UI (`FileList`, `Sidebar`, `Toolbar`, `PathBar`, `StatusBar`, `IconForKind`). Settings live in a Context store at `state/settings.tsx`, persisted to `localStorage`. The MUI theme switches between light/dark/system via `theme/index.ts`. Pure utilities live in `util/`. Typed `invoke` wrappers live in `api/fs.ts`. Tauri APIs are mocked in `src/test/setup.ts` so component tests don't need a Tauri runtime.
- **`src-tauri/` (Rust)** — Tauri v2 shell. The filesystem layer lives in `src/fs/` with `types.rs` (Entry, FileKind, ListOptions), `local.rs` (sync filesystem ops + DirSummary type), `icons.rs` (extension → kind), `sftp.rs` (async SFTP backend via russh), and `registry.rs` (live-connection map held in Tauri State). The Skiffsync engine lives in `src/sync/` with `types.rs` (ConflictPolicy, JobOptions, Progress, Summary), `plan.rs` (pre-scan), `engine.rs` (executor + skip-if-unchanged + cancel token), and `registry.rs` (job tracking). Tauri command adapters live in `src/commands.rs` and are registered in `src/lib.rs`. Future remote backends (ftp/smb) join under `fs/`.

## Phase status

- **Phase 0** — ✅ scaffold + branding + CI workflows + public repo
- **Phase 1** — ✅ local file explorer (browse, navigate, mkdir, rename, remove, copy; virtualized list; light/dark/system theme; settings page)
- **Phase 1.5** — ✅ right-side preview pane (image / text / markdown / folder summary; toolbar toggle; `previewMode` setting: off / images-only / always; pdf + audio/video previews still pending — covered by later polish)
- **Phase 2a** — ✅ SFTP backend (russh + russh-sftp, pure-Rust), connection registry as Tauri State, conn_* commands, Connections page (add/list/disconnect/save drafts), Sidebar live-host list. Real SFTP integration tests deferred to Phase 3 (need docker harness).
- **Phase 2b** — ✅ Browser remote integration: `sftp://<connection_id>/<path>` scheme parsed by `util/location.ts`; `api/client.ts` unifies fs_*/conn_* dispatch; pathSegments / parentPath are scheme-aware; clicking a host in the Sidebar opens that connection in the Browser. mkdir/rename/remove/upload on remote, ssh-config import, and known-hosts TOFU still pending — schedule those when Phase 3 lands docker-based integration tests.
- **Phase 3** — pending — FTP/FTPS + SMB
- **Phase 4a** — ✅ Skiffsync local-to-local: `src-tauri/src/sync/` with plan + engine + registry. Skip-if-unchanged (size + lookback-days), conflict policies (skip / overwrite / keepBoth), dry-run, cancel between files, max-size guard, per-file progress events (`sync:progress` / `sync:done` / `sync:error`). Transfers page (`/transfers`) drives jobs and shows progress bars.
- **Phase 4b** — ✅ smart-batch conflict policies (overwriteOlder / replaceSmaller / replaceIfSizeDifferent / renameTarget / renameOlderTarget). Cross-protocol src/dest, interactive TeraCopy modal with apply-to-all, and pause/resume all shipped. `cpstamp`, `dedup`, `cprepo` modes available. Saved-job templates persisted to settings.
- **Phase 5+** — see TODO.md

The phase-by-phase shipping notes (every 0.1.x and 0.2.x patch) live in [`CHANGELOG.md`](./CHANGELOG.md). When you ship a new patch version, append the entry there, not here.

## Backlog policy

The "Backlog" section at the bottom of TODO.md contains items the user has explicitly deferred. **Do not implement them or add tests for them unless the user explicitly says "go work on X" by name.** As of 2026-05-06 this list contains, in priority order:

- **Unified progress dialogs** for all in-progress operations (delete / copy / cut+paste / sync) — determinate bar + files counter + rolling-window ETA + current item + pause/cancel; same widget across every long-running flow. *Top of backlog.*
- **Cloud storage backends** — Google Drive / OneDrive / S3 / Azure Blob + Files. OAuth 2.0 + OS-keychain token storage; slot into the same `RemoteFs`-style abstraction as SFTP. Path schemes `gdrive://` / `onedrive://` / `s3://` / `azureblob://`. Streaming uploads (multipart / resumable). Settings → Connections gets per-cloud "Add" buttons.
- Built-in archive viewer (zip/tar/7z)
- User-customizable theme (custom MUI palettes + presets, with color pickers)

## Versioning

Single source of truth: **`src-tauri/tauri.conf.json` → `version`**. `build.rs` reads it and exposes `APP_VERSION` as a compile-time env var (`env!("APP_VERSION")`). Dev builds append `[DEV]`; CI release builds set `TAURI_RELEASE=true` for a clean string.

`package.json` and `src-tauri/Cargo.toml` versions are not used by the app — leave them at `0.1.0` / `0.0.0`.

## Conventions

- All Rust structs sent to the frontend use `#[serde(rename_all = "camelCase")]`.
- Tauri commands are `snake_case` in Rust, called with `snake_case` strings from `invoke()`.
- Frontend parameter objects use `camelCase` (Serde converts).
- Always add tests for new code: React components get `*.test.tsx` (Vitest + Testing Library), Rust modules get `#[cfg(test)] mod tests` blocks.
- **Performance is a feature.** Never block the UI thread; never call `read_to_end` on user files; always virtualize lists; always cancel inflight scans on navigation.
- Theme tokens live in `src/theme/{light,dark}.ts`; never hard-code colors in components.

## Known footguns + patterns to avoid

These are bugs that have bitten the app at least once. Add a check / regression test when you touch the related area.

- **Don't use `window.alert` / `window.confirm` / `window.prompt` in Tauri.** The webview suppresses them in some configurations — code that gates on `if (!window.confirm(…)) return;` silently no-ops, so destructive actions like Move-to-Trash, "Reset all settings", and "New folder" / "New file" auto-naming flows appeared dead. Use a modal dialog (`ConfirmDialog`, `RenameDialog`, `NewEntryDialog`) instead. Pattern: lift `open` + `onConfirm` into the parent's state.

- **Don't define React components inline inside the parent function.** A component declared inside another component's body is a fresh type on every render — React tears down the old subtree and remounts a new one each parent render. Click handlers and inputs on that subtree silently break. Always declare reusable components at module scope (or memoize with `useCallback` + a stable component ref). The Sidebar's `SectionHeader` regression (clicking the section header didn't toggle collapsed) was exactly this.

- **HashRouter + StrictMode + nested conditional `<Routes>` had a render-loop bug.** Reproduced 2026-05: clicking a sidebar nav link flipped the URL to `/settings`, but a render later something flipped it back to `/` and the page never switched. Fixed by ditching react-router for top-level page switching and using a `Page` state in App. If you re-introduce react-router, write a test that asserts `useLocation().pathname` is stable for one tick after `navigate()` returns.

- **Skiffsync's `start_local` / `start_cross` returns once the job is QUEUED, not once it's done.** Don't rely on `await startSync(...)` then immediately `refresh()` — the file isn't on disk yet. Use the synchronous `fs_copy_recursive` / `fs_copy_file` for one-shot duplicate flows, or wait for `sync:done` events.

- **Find-in-subfolders gating:** when the recursive-find toggle is on but the search input is blank, `findResults` is `[]`. Don't substitute that for the listing — it'll show "Empty folder" out of the blue. Always require both the toggle AND a non-empty query before swapping in find results.

- **Page container layout:** route pages (`SettingsPage`, `TransfersPage`, `ConnectionsPage`) sit inside a flex-column main area. They MUST set `flex: 1` (not `maxWidth`) on the outer Box or the page won't fill the available width. Use an inner `Box maxWidth=… mx="auto"` for content centering.

- **MUI theme: never spread typography / transitions from a baked theme.** `createTheme` bakes per-variant pixel sizes (body1, h1, …) and per-component transition strings at construction time. Doing `createTheme({ ...base, typography: { ...base.typography, fontSize: 16 } })` does NOT rescale variants — the old pixel sizes are already concrete. Same for `transitions.create`. Always recompose the theme from input options in a single `createTheme(...)` call. The Settings → Font size / Reduce motion toggles silently no-op'd until 0.2.129 because of this. To make font size actually visible, also override `MuiCssBaseline.html.fontSize` so non-Typography text (buttons, MenuItems) picks up the scale.

- **Keyboard shortcuts: `e.key` is layout-dependent.** On macOS US, Shift+. emits `>` (not `.`). Bindings like Cmd+Shift+. silently never fire if you check `e.key === "."`. For symbol keys, accept multiple variants (`. > Period`) or use `e.code` which is layout-independent. Bit Skiff at 0.2.129 (toggle hidden files binding); the cheatsheet had been advertising it for weeks.

- **Multi-window state isolation.** Tauri makes spawning extra windows trivial (`WebviewWindowBuilder`) — but each window holds its own React tree + settings cache. Without a sync mechanism, flipping the theme in window A leaves window B stale. Pattern: emit a `settings:changed` Tauri event after every persisted save, listen in every window + reload from disk; also reload on `window` focus as a safety net for missed events. See `commands.rs::settings_save` + `App.tsx`'s settings-sync effect.

- **Vibe-coded UI controls — verify the visual effect, not just persistence.** Several Settings dropdowns / toggles (font size, density, reduce motion, status bar) had wired-up `onChange` handlers + correctly persisted state, but the visual didn't change because the consumer read the wrong shape, the layer between settings and render was misconfigured, or the prop wasn't threaded down at all. View modes (tile / gallery / column) shipped as toolbar buttons that merely updated `folderViewMode` while FileList only ever rendered the list layout. **When you add a Settings control, the smoke test is "flip it in the running app and watch the pixels change"** — typecheck + tests pass even when the wire doesn't connect.

- **Right-click context menu consistency.** Every clickable surface that has actions needs a context-menu equivalent. The Sidebar's bookmark rows had inline ↑↓× buttons but no right-click menu (only a rename); favorites + recent had nothing. Users muscle-memory right-click everywhere. Pattern: build a small presentational `*ContextMenu` component (`SidebarContextMenu`, `EntryContextMenu`) and have the parent supply the action list per-row, mirroring whatever inline buttons exist. Keep disabled-state in sync between inline and menu (e.g. "Move up" disabled at index 0).

- **Cosmetic feedback for the right-click target.** When a context menu opens, the user needs to see WHICH row it acts on — selection / focus state is misleading because the right-click doesn't necessarily change the multi-selection. Pattern: track `contextMenuPath` separately from `selected` / `focusedIdx`, draw a non-state inset outline on the targeted row, clear when the menu closes. See FileList's three-way precedence: drag-over > context-target > focused.

- **Hardcoded affordance lists need an escape hatch.** The Sidebar's FAVORITES (Home / Desktop / Documents / Downloads / Trash) was hardcoded with no way to hide individual entries — users either tolerated all five or hid the whole section in Settings. Pattern: pair every hardcoded list with a `hidden<Thing>: string[]` setting + an inline hide affordance. Same for sections themselves (a hover-visible × icon on each section header beats burying visibility in Settings → Sidebar).

- **Always virtualize list-like surfaces.** "It's only ~100 entries on average" is a trap. Power users have 10k-entry Downloads folders. Tile / Gallery / Column views shipped non-virtualized at 0.2.132 and were sluggish at 1k+ entries (0.2.134 fix). Pattern for grids: ResizeObserver on the parent, compute `cols = floor(width / cellWidth)`, virtualize rows with `useVirtualizer`, render `cols` cells per virtual row. Streaming `fs_list_dir` for incremental render is the next step for mega-folders.

- **macOS TCC sandbox makes parts of $HOME unreadable.** `~/.Trash` returns "Operation not permitted (os error 1)" from `read_dir` unless the app has Full Disk Access. The user's first-pass UX for clicking the Trash favorite navigated in-app and surfaced a red error banner. Pattern for OS-special folders: detect at command-add time, route through `fs_open_with_default` so the OS native file manager (which has the entitlement) handles it. Other macOS hot spots: `~/Library/Mail`, `~/Pictures/Photos Library.photoslibrary`, `~/Library/Messages`. Linux + Windows don't have an equivalent, but Windows' Recycle Bin isn't a real fs path either — `fs_trash_path` returns `null` on Windows so the favorite hides itself.

- **Async-vs-sync mismatch in user-facing flows.** When a user clicks "Duplicate" they expect the file to be on disk + visible in the listing immediately after. Skiffsync's `start_local` returns when the job is *queued*, so a follow-up `refresh()` raced a stale listing. For one-shot user actions, prefer the synchronous Tauri command (`fs_copy_recursive`) over Skiffsync's async engine. Reserve Skiffsync for genuinely-long-running transfers where progress events drive the UI.

- **Continuous gestures (drag-resize, slider, scroll-throttled) should NOT call `update()` per mousemove.** Calling `update("foo", next)` at 60 fps fires the persist effect every frame, which fires `settings_save`, which broadcasts `settings:changed`, which our App listener consumes by reloading from disk and calling `setSettings(fromDisk)`. At drag speed this races: a stale disk read can land mid-drag and snap the value back. Manifested as the sidebar / preview-pane width "snapping back" after a drag (0.2.167 / 0.2.168). Pattern: **drag-then-commit**. Track a local `dragWidth: number | null` in the dragging component; mousemove updates the local state only; render uses `dragWidth ?? settings.persistedValue`; mouseup calls `update()` ONCE with the final value, then clears the local state. One persist tick per gesture, no race window. Apply to any future continuous control (font-size slider, opacity, throttled inputs).

- **State sync that round-trips THROUGH a side-channel must dedup by VALUE, not by reference.** Bit Skiff hard at 0.2.135 → 0.2.138 (the view-mode oscillation). Root-cause shape: Component A writes to setState → useEffect [state] persists to a side-channel (Tauri event / websocket / localStorage `storage` event) → Component A's own listener on that side-channel fires → reload payload + setState(payload) — payload is a fresh object reference even when values are identical → React sees a new ref → persist effect re-arms → side-channel emits again → listener fires again → infinite loop. The fix has to live at the *writer*: dedup the persist effect with a value comparison (`JSON.stringify` against a ref of the last successfully-persisted value) so a re-entrant equal-by-value setState becomes a no-op at the persist boundary. A reader-side equality check (skip applying when fromDisk equals current state) is a useful second guard but is not sufficient on its own — by the time the reader compares, the writer's setState has already produced a new object ref and re-armed the effect one tick earlier. Whenever you wire a feedback path (event broadcast, file watcher, storage event), pin a regression test that calls setState with an equal-by-value but new-by-reference object and asserts the persist call count stays at zero. See `settings.test.tsx::"persist effect dedup (regression for the cross-window loop)"`.

  *Investigation pattern that helped distill this:* the user reported "view mode keeps switching back and forth between gallery and column on a single click." Initial guess: scrollbar feedback loop in the grid layout (overflow appearing/disappearing changes width → cols recomputes → content re-fits without scrollbar → repeat). That fix shipped in 0.2.135 but didn't help. Second guess: useEffect-vs-useLayoutEffect race on first measurement (containerWidth=0 on first paint → cols=1 flash). Shipped in 0.2.136, still didn't help. The "single window only" scope finally pointed at the cross-window settings sync I'd just added — even though there was only one window, the source window's own listener received its own emit and fed its own setSettings back. **Lesson: when a fix doesn't help, the next iteration should change the layer of the model you're poking at, not just the local code.** Layout → render-timing → state-flow each represent a different layer; cycling through them as hypotheses converges faster than tweaking the same layer twice.

## Lessons distilled from the 0.2.127 → 0.2.134 bug-fix sweep

The first-pass implementation of Settings + Sidebar + view modes had a recurring shape: **the UI affordance was added (toggle / dropdown / icon button) and the setting was wired through to state, but the consumer either never read the value, read the wrong shape, or built downstream artifacts in a way that ignored the setting.** Eight separate Settings controls landed broken this way (font size, density, reduce motion, status bar, view modes ×3, hidden files shortcut). Single-window assumptions, hardcoded affordance lists, and missing right-click parity were the other recurring themes.

Future-Claude checklist when adding any UI affordance:

1. **Smoke test in the running app.** Typecheck + Vitest pass on bindings that don't actually flow through. Run `npx tauri dev`, flip the control, and verify the pixels change.
2. **Match key bindings to the OS layout.** Use `e.code` for symbol keys, accept multiple `e.key` variants for layout differences.
3. **Right-click anywhere should reveal an action menu.** If the surface accepts inline button actions, mirror them in a context menu with the same disabled-state logic.
4. **Show which row a context menu acts on.** Cosmetic outline ≠ selection state.
5. **Pair hardcoded lists with a hide-mechanism.** `hidden<Thing>: string[]` + inline × icon + Settings → restore-all.
6. **Plan for multi-window from the start.** Settings sync via a Tauri event broadcast on every save + focus reload.
7. **Virtualize anything list-shaped.** Including grid views — compute cols-per-row from container width, virtualize rows, render cells inline.
8. **Detect OS sandbox boundaries.** macOS TCC, Windows Recycle Bin pseudo-path, Linux locked permission dirs — route to OS-native handlers when in-app reads fail.
9. **Pick sync vs async transports per UX expectation.** Sync Tauri command for "do X then refresh"; async sync engine + progress events for long-running transfers.
10. **End-to-end test flow per fix.** When you patch a bug, write a regression test that asserts the *visible behavior* (not just the state mutation) — App.test.tsx's Cmd+\\ test toggles the binding and asserts "Favorites" disappears from the DOM, which is what actually broke.

## CI / Release Workflows

- **`build.yml`** — runs on every push/PR to `main`, runs `npm test` and `cargo test` then builds the Tauri bundle on macOS (ARM + Intel), Windows, Linux. Posts a PR comment with artifact download links.
- **`release-official.yml`** — triggered by `v*` tag pushes or manual `workflow_dispatch`. Uses `synle/workflows/actions/release/begin-release` → matrix Tauri build → `end-release`. Sets `TAURI_RELEASE=true`.
- **`release-beta.yml`** — manual `workflow_dispatch` only. Builds a draft prerelease tagged `release-beta-<date>-<sha>`.

Use `/release-official` and `/release-beta` slash commands to trigger interactively.

## GitHub Raw File URLs

Always use the `?raw=1` blob URL format: `https://github.com/{owner}/{repo}/blob/head/{path}?raw=1`.

Do NOT use `api.github.com/repos/.../contents/` or `raw.githubusercontent.com`.

## Git / PR Merge Policy

- Always use **squash and merge** for PRs.
- **Always rebase before pushing** (`git pull --rebase` before `git push`).
