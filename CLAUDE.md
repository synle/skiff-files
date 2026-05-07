# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**Skiff Files** — a fast, cross-platform desktop file explorer for Windows / macOS / Linux. Built with **Tauri v2** (Rust backend) + **React 19** (TypeScript) + **MUI v9** + **Vite 6**. No sidecar — all backend logic lives in the Rust crate, which keeps bundles small and avoids a Node runtime.

Supports local FS, SSH/SFTP, FTP/FTPS, SMB/Samba, and (optional) NTFS mounts. Headline feature is **Skiffsync**, a `cpsync`-inspired smart-copy engine that skips unchanged files across protocols.

The phased implementation plan is in [`TODO.md`](./TODO.md). Always consult it before starting a new feature.

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
- **Phase 4b (in progress)** — smart-batch conflict policies (overwriteOlder / replaceSmaller / replaceIfSizeDifferent / renameTarget / renameOlderTarget — TeraCopy parity for per-file decisions). `cpstamp`, `dedup`, `cprepo` modes shipped. **Saved job templates** persisted to localStorage (Run + Delete actions on each). Still pending: cross-protocol src/dest, interactive TeraCopy modal (Overwrite/Skip/Keep both — applies-to-all-remaining), pause/resume.

- **0.1.4 polish** — OS trash via `trash` crate (`fs_trash` / `fs_trash_many`), Delete key in Browser sends selection to trash with confirm. Settings now persist to `app_data_dir/settings.json` via `settings_load` / `settings_save` Tauri commands; localStorage stays as a hot cache + test fallback.
- **0.1.5 polish** — In-pane live search (Cmd/Ctrl+F focuses; Esc clears). OS drag-and-drop into the Browser pane: Tauri drag-drop events route each dropped path through `sync_start_local` (directories nest under their basename so they land AT the cursor target rather than flatten), with a translucent overlay during drag-over. Remote folders refuse drops cleanly until 4b lands.
- **0.1.6 polish** — Sync **pause / resume**. `CancelToken` grew a `pause` flag + `wait_if_paused()` (50 ms poll loop, breaks on cancel). `sync_pause` / `sync_resume` Tauri commands; new `JobState::Paused`. Transfers UI shows Pause/Resume button per in-flight job alongside Cancel; state flips locally on click for instant feedback (no wait for the next progress tick).
- **0.1.7 polish** — **Interactive TeraCopy modal** for `ConflictPolicy::Prompt`. New `ResolverHub` (`Mutex<HashMap>` + `Condvar`) parks the executor on a fresh `conflict_id` per file; `sync:conflict` event surfaces src/dest metadata to the frontend; `sync_resolve_conflict` deposits the user's choice. Modal shows side-by-side metadata with "Same size" / "Same date" badges, queues multiple conflicts, and offers Overwrite / Skip / Keep both / Cancel job. The smart-batch row from the screenshot ("Overwrite all older", etc.) lands later — those policies already exist in the engine, the UI just needs the apply-to-all toggle.
- **0.1.8 polish** — **Recursive find**. New `fs::local::find` walks the tree depth-first, capped at 1000 results / 10 s. Prunes `.git` / `node_modules` / `_recycleBin`. Toolbar gets a search-icon `ToggleButton` that switches the search input between in-pane filter (default) and recursive-find mode. Browser debounces the find call by 300 ms so each keystroke doesn't kick a fresh disk walk; results replace the filtered list until the user clears the query or navigates.
- **0.1.9 polish** — **Tabs**. New `components/BrowserTabs.tsx` wraps the `/` route in a tab strip; multiple `Browser` instances stay mounted under `display:none` so switching tabs is instant and full Browser state (history, sort, search, selection) is preserved. `Browser` accepts `isActive` + `onPathChange` — every global listener (sidebar nav, drag-drop, Delete, Cmd/Ctrl+F) gates on `isActive` so only the foreground tab responds. Cmd/Ctrl+T = new tab, Cmd/Ctrl+W = close, Cmd/Ctrl+1..9 = switch. Last tab is always preserved.
- **0.1.10 polish** — **SFTP write side**. `SftpClient` grew `mkdir` (recursive, idempotent — walks parents and ignores already-exists), `rename` (same-FS only), and `remove` (recursive: post-order DFS, deletes files first then rmdir's deepest-first). New `conn_mkdir` / `conn_rename` / `conn_remove` Tauri commands. `api/client.ts` gained `mkdir(path)` + `removeOrTrashMany(paths)` that dispatch by scheme — Browser's New-folder + Delete now work transparently against remote hosts (with a "permanently delete" confirm wording when remotes are in the selection, since there's no server-side trash).

## Phase 0.2.x — cross-protocol Skiffsync

- **0.2.8** — ✅ **Sidebar bookmarks**. Pinned paths (local + sftp) appear above Hosts in the sidebar. Add via right-click on a folder → "Add to bookmarks"; remove via the X icon in the sidebar row. Bookmarks persist as part of `Settings.bookmarks` (already on disk via `settings_save`). Section is hidden when empty so the sidebar stays uncluttered for new users.
- **0.2.7** — ✅ **File properties dialog**. Reachable via right-click → Properties…. Shows kind / size / modified / mode / path; for directories, kicks off a recursive `dirSummary` and fills in the total size + entry count once the scan finishes (the in-flight state shows "Calculating…" so it doesn't block the dialog from opening).
- **0.2.6** — ✅ **Apply-to-all in the conflict modal**. New `OverwriteAll` / `SkipAll` / `KeepBothAll` decisions complete the TeraCopy modal action set. Both engine closures (local + cross) wrap their `wait_for` with an `Arc<Mutex<Option<Decision>>>` sticky cache: clicking an "All" button caches the normalized per-file equivalent, and every subsequent conflict in the same job short-circuits before emitting another `sync:conflict` event. The modal only renders the apply-to-all row when more than one conflict is queued (single-prompt UX stays uncluttered).
- **0.2.5** — ✅ **Cross-mode `RenameTarget` + `RenameOlderTarget`**. Closes the last cross-vs-local conflict-policy gap. Aside-rename uses `Backend::rename` (same-backend, supported by both local + sftp); the subsequent copy stays cross-backend. `aside_rename_path` walks `(old)`, `(old 2)`, `(old 3)` if a previous run left siblings around. Cross mode now matches the local engine's full TeraCopy policy set 1:1.
- **0.2.4** — ✅ **Cross-mode Prompt support**. The interactive TeraCopy modal now works for cross-protocol jobs. `execute_cross` grew an `on_prompt: FnMut(file, meta) -> Future<Option<ConflictPromptDecision>>` parameter; `sync_start_cross` wires the same `ResolverHub` + `sync:conflict` event flow that `sync_start_local` uses. Result: setting policy=prompt on a local→sftp or sftp→local job pops the modal per file with side-by-side metadata, just like local-only jobs.
- **0.2.3** — ✅ **Right-click context menu** in the FileList. `EntryContextMenu` anchors at click coords; surfaces Open (folders only), Rename…, Copy path, and Move to Trash (with the same "Permanently delete" wording for remote entries that the Delete-key path uses). Right-clicking promotes the row to primary selection so the preview pane and menu stay in sync.
- **0.2.2** — ✅ **F2 rename**. New `RenameDialog` opens on F2 against the primary-selected entry. `client.rename(from, to)` dispatches to `fs_rename` (local) or `conn_rename` (sftp); refuses cross-backend renames since those should go through a sync_start_cross job (copy + remove). The dialog pre-selects the file stem so users can type a replacement immediately. Shortcut documented in the cheatsheet modal.
- **0.2.1** — ✅ **Streaming cross-engine**. The 0.2.0 256 MB in-memory cap is gone. `Backend::open_read` / `open_write` return `Pin<Box<dyn AsyncRead/Write + Send>>`; `Backend::copy_file(src_path, dest, dest_path)` short-circuits to `std::fs::copy` for local-to-local (kernel-accelerated) and uses `tokio::io::copy` for everything else. Multi-GB files now stream cleanly across protocols.
- **0.2.0** — ✅ **Cross-protocol Skiffsync first slice**. New `sync/backend.rs` with `Backend::Local` / `Backend::Sftp(Arc<SftpClient>)` enum + async `metadata` / `read_full` / `write_full` / `mkdir_p` / `rename` + a `walk_files` helper. New `sync/cross_engine.rs` with `plan_cross` + `execute_cross` (async) that mirror the local engine's loop shape but route every IO through the backend abstraction. `sync_start_cross` Tauri command spins a per-job tokio runtime and resolves `sftp://<id>/<path>` URLs through the connection registry. Frontend `api/client.ts` got `startSync(src, dest, options)` that picks `sync_start_local` for pure local-to-local (kernel-accelerated path) and `sync_start_cross` whenever a remote is involved. TransfersPage + Browser drag-drop both use it — drops onto an `sftp://` folder Just Work now. **Limitations** (planned for 0.2.1+): per-file copies are buffered in-memory (256 MB cap; larger files surface as per-file errors); rename* policies and Prompt fall through to skip in cross mode; no streaming; no smart-batch UI yet for cross.
- **Phase 5+** — see TODO.md

## Backlog policy

The "Backlog" section at the bottom of TODO.md contains items the user has explicitly deferred. **Do not implement them or add tests for them unless the user explicitly says "go work on X" by name.** As of 2026-05-06 this list contains, in priority order:

- **Unified progress dialogs** for all in-progress operations (delete / copy / cut+paste / sync) — determinate bar + files counter + rolling-window ETA + current item + pause/cancel; same widget across every long-running flow. *Top of backlog.*
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
