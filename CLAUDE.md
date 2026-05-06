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
- **`src-tauri/` (Rust)** — Tauri v2 shell. The filesystem layer lives in `src/fs/` with `types.rs` (Entry, FileKind, ListOptions), `local.rs` (sync filesystem ops), and `icons.rs` (extension → kind). Tauri command adapters live in `src/commands.rs` and are registered in `src/lib.rs`. Future remote backends (sftp/ftp/smb) and the `Skiffsync` engine will sit alongside `local` under `fs/` and `sync/` respectively.

## Phase status

- **Phase 0** — ✅ scaffold + branding + CI workflows + public repo
- **Phase 1** — ✅ local file explorer (browse, navigate, mkdir, rename, remove, copy; virtualized list; light/dark/system theme; settings page)
- **Phase 1.5** — ✅ right-side preview pane (image / text / markdown / folder summary; toolbar toggle; `previewMode` setting: off / images-only / always; pdf + audio/video previews still pending — covered by later polish)
- **Phase 2** — pending — connection abstraction + SFTP
- **Phase 3** — pending — FTP/FTPS + SMB
- **Phase 4** — pending — Skiffsync engine (TeraCopy-style conflict resolution)
- **Phase 5+** — see TODO.md

## Backlog policy

The "Backlog" section at the bottom of TODO.md contains items the user has explicitly deferred. **Do not implement them or add tests for them unless the user explicitly says "go work on X" by name.** As of 2026-05-06 this list contains the built-in archive (zip/tar/7z) viewer.

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
