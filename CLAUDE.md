# CLAUDE.md

Guidance for Claude Code in this repo.

## Project

**Skiff Files** — fast cross-platform desktop file explorer (Windows / macOS / Linux). Tauri v2 (Rust) + React 19 (TS) + MUI v9 + Vite 6. No sidecar. Supports local FS, SSH/SFTP, FTP/FTPS, SMB/Samba, optional NTFS. Headline feature is **Skiffsync**, a `cpsync`-inspired smart-copy engine that skips unchanged files across protocols.

## Read first

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module map, IPC flow, cross-component coordination, saved-data parity, conventions per layer.
- [`DEV.md`](./DEV.md) — setup, day-to-day commands, project layout, **footguns** (bugs that have already bitten us — read before touching shared infra), where-to-look table.
- [`TODO.md`](./TODO.md) — phased roadmap + deferred backlog.
- [`CHANGELOG.md`](./CHANGELOG.md) — per-patch shipping notes. When you ship a patch version, append the entry here.

## Conventions to follow

- All Rust structs sent to the frontend use `#[serde(rename_all = "camelCase")]`.
- Tauri commands are `snake_case` in Rust, called with `snake_case` strings from `invoke()`. Frontend parameter objects use `camelCase` (Serde converts).
- New code gets tests: React → `*.test.tsx` (Vitest + Testing Library), Rust → `#[cfg(test)] mod tests` block.
- Theme tokens live in `src/theme/{light,dark}.ts` — never hardcode colors.
- **Performance is a feature.** Never block the UI thread; never `read_to_end` on user files; always virtualize lists; always cancel inflight scans on navigation.
- Versioning: only `src-tauri/tauri.conf.json#version` matters. `package.json` and `src-tauri/Cargo.toml` versions are unused — leave them at `0.1.0` / `0.0.0`.

## Backlog policy

The "Backlog" section at the bottom of TODO.md contains items the user has explicitly deferred. **Do not implement or test them unless the user explicitly says "go work on X" by name.**

## Footgun checklist (full context in DEV.md)

Touch the related code → read the matching DEV.md entry. The most-bit ones:

- No `window.alert` / `window.confirm` / `window.prompt` — Tauri webview suppresses them. Use modal dialogs.
- Don't define React components inline inside another component.
- Skiffsync `start_*` returns when the job is QUEUED — for one-shot copies use sync `fs_copy_recursive`.
- Settings persist effect must dedup by VALUE (not ref) or you'll loop via the cross-window event.
- Continuous gestures: drag-then-commit, not `update()` per mousemove.
- `e.key` is layout-dependent — use `e.code` for symbol keys.
- macOS TCC blocks parts of `$HOME` (`~/.Trash`, `~/Library/Mail`…) — route to OS-default handler.
- Always virtualize list-shaped surfaces, including grids.
- Multi-window settings sync via `settings:changed` Tauri event + focus reload.
- Saved-data types ship with all five surfaces (sidebar / drag / right-click / palette / Settings) — see ARCHITECTURE.md.
- Rebindable shortcuts go through `matchesCombo(e, activeCombo(...))`, not raw `e.key`.
- Cross-component actions go through window CustomEvents (`skiff:*`), not prop-drilling.

When you add a UI affordance: smoke-test it in `npx tauri dev` and watch the pixels change. Typecheck + Vitest pass on bindings that don't actually flow through.

## Git / PR policy

- Always **squash and merge** PRs.
- Always **rebase before pushing** (`git pull --rebase` before `git push`).
- GitHub raw file URLs: use the blob+`?raw=1` form: `https://github.com/{owner}/{repo}/blob/head/{path}?raw=1`. Never `api.github.com/repos/.../contents/` or `raw.githubusercontent.com`.
