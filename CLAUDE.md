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

## Secrets & environment hygiene — non-negotiable

The coverage pipeline (0.2.250) ships full source-code HTML reports as a CI artifact, and the workflow run page surfaces them publicly on every push. Treat coverage artifacts, commits, comments, logs, and chat output as **all equally public**. The rules:

- **Never write a real secret to disk, ever.** Not in code, not in tests, not in comments, not in commit messages, not in changelogs, not in docs, not in `.env.example`, not in fixture files. If you need to reference a real key (debugging, etc.) ask the user to paste it transiently into the conversation; never echo it back, log it, or write it to a file.
- **No real-looking credentials in test fixtures.** Mock values must be obviously fictional — `"test-conn-id"`, `"x".repeat(N)`, `"DUMMY_TOKEN"`. Strings that read like plausible passwords (`"hunter2"`, `"password123"`) get embedded by name in Vitest's coverage HTML and look suspicious to anyone scanning the artifact. Extract to a `DUMMY_*` constant if a string literal is unavoidable.
- **Never read secrets from process.env / std::env at module load.** The variable *name* alone tells an attacker what to phish for. If you must read env, do it inside a function called at runtime, not at top-level, and never echo the value.
- **CI workflow secrets are job-scoped.** `${{ secrets.X }}` may only appear in jobs that genuinely need it (release, signing). The `coverage` + `build` + `pr_comment` jobs should never reference repo secrets. `GITHUB_TOKEN` flows only where `tauri-action` / artifact upload needs it.
- **Don't commit `.env`, `.env.local`, `.npmrc` with auth, `.cargo/config.toml` with registry tokens, `secrets.json`, signing keys, or any keychain export.** `.gitignore` already covers `.env*` — keep that line intact.
- **Sanitize before logging.** If a log statement could touch user data (path, host, user, query), confirm it's a non-identifying discriminator (size, count, kind, status code) before merging. Identifiers in URLs / paths / workflow keys are PII; see footguns in DEV.md.
- **Audit before shipping anything that publishes source publicly.** Coverage HTML, screenshot uploads, paste-bins, PR diffs in external systems — they all bake source in. Grep for `AKIA`, `xoxb-`, `ghp_`, `sk-`, `eyJ`, `BEGIN PRIVATE KEY`, `password.*=.*"` before publishing artifacts you didn't write.

If you spot a leak in an existing file: flag it before fixing, because rotation of the underlying credential is the actual fix — the source change is just hygiene.

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
