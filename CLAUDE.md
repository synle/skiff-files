# CLAUDE.md

Guidance for Claude Code in this repo.

## Project

**Skiff Files** — fast cross-platform desktop file explorer (Win/macOS/Linux). Tauri v2 (Rust) + React 19 (TS) + MUI v9 + Vite 6. No sidecar. Supports local FS, SSH/SFTP, FTP/FTPS, SMB/Samba, optional NTFS. Headline feature: **Skiffsync**, a `cpsync`-inspired smart-copy engine that skips unchanged files across protocols.

## Read first

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module map, IPC flow, saved-data parity, per-layer conventions.
- [`DEV.md`](./DEV.md) — setup, commands, project layout, **footguns** (read before touching shared infra), where-to-look table.
- [`COVERAGE.md`](./COVERAGE.md) — how coverage is measured + where the floors live.
- [`TODO.md`](./TODO.md) — phased roadmap + deferred backlog.
- [`CHANGELOG.md`](./CHANGELOG.md) — per-patch notes. Append on every patch ship.

## Conventions

- Rust structs sent to frontend: `#[serde(rename_all = "camelCase")]`. Tauri commands are `snake_case` in Rust, invoked with `snake_case` strings; frontend param objects are `camelCase`.
- New code gets tests: React → `*.test.tsx` (Vitest + Testing Library), Rust → `#[cfg(test)] mod tests`.
- Theme tokens live in `src/theme/{light,dark}.ts` — never hardcode colors.
- **Performance is a feature.** Never block the UI thread; never `read_to_end` on user files; virtualize lists; cancel inflight scans on nav.
- Versioning: **only `src-tauri/tauri.conf.json#version` matters.** Never bump `package.json` or `src-tauri/Cargo.toml` versions — they're intentionally pinned (currently `0.1.1` / `0.0.0`) and `build.rs` pulls `APP_VERSION` from `tauri.conf.json` for Rust.

## Coverage gate

Both frontend and Rust coverage are gated in CI. **Don't hardcode the floor numbers here — they ratchet up over time. Read them from the source of truth:**

- **Frontend (Vitest, v8)** — thresholds live in [`vite.config.ts`](./vite.config.ts) under `test.coverage.thresholds` (`lines` / `statements` / `branches` / `functions`). `npm run test:coverage` enforces them locally; the `coverage` job in [`.github/workflows/build.yml`](./.github/workflows/build.yml) enforces them in CI.
- **Rust (`cargo-llvm-cov`)** — floors are passed inline to `cargo llvm-cov` as `--fail-under-lines` / `--fail-under-functions` / `--fail-under-regions` in [`.github/workflows/build.yml`](./.github/workflows/build.yml) (search `fail-under`). Local: `cd src-tauri && cargo llvm-cov --lib --summary-only`.
- **Policy lives in [`COVERAGE.md`](./COVERAGE.md)** — floors stay 1pt below baseline, never lowered to pass CI, raised as coverage improves.

## Secrets & env hygiene — non-negotiable

Coverage HTML ships as a public CI artifact (0.2.250). Treat coverage artifacts, commits, comments, logs, chat output as **all equally public**.

- **No real secret on disk, ever** — code, tests, comments, commits, changelogs, docs, `.env.example`, fixtures. Need a real key transiently? Have the user paste it in-conversation; never echo or write it.
- **No real-looking creds in fixtures.** Use obviously fake values (`"test-conn-id"`, `"DUMMY_TOKEN"`, `"x".repeat(N)`). Plausible-looking literals (`"hunter2"`) get baked into Vitest's coverage HTML by name.
- **No `process.env` / `std::env` reads at module load.** The variable *name* alone is a phishing target. Read env inside runtime functions only; never echo.
- **CI secrets are job-scoped.** `${{ secrets.X }}` only in jobs that need it (release, signing). `coverage` / `build` / `pr_comment` reference no repo secrets.
- **Don't commit** `.env*`, `.npmrc` with auth, `.cargo/config.toml` with tokens, `secrets.json`, signing keys, keychain exports. Keep `.gitignore` `.env*` line intact.
- **Saved connection passwords live in the OS keychain**, not on disk. Service = `com.synle.skiff-files`, account = `auth:<connection-id>`. Backend in [`src-tauri/src/creds.rs`](./src-tauri/src/creds.rs); recovery / inspection recipes per platform in [DEV.md → Credential storage](./DEV.md#credential-storage--os-keychain). Never log or echo a secret read back from the keychain.
- **Sanitize before logging.** Paths/hosts/users/queries are PII — log non-identifying discriminators (size, count, kind, status). See DEV.md footguns.
- **Audit before publishing source.** Before any artifact that bakes source (coverage HTML, screenshots, pastebins), grep for `AKIA`, `xoxb-`, `ghp_`, `sk-`, `eyJ`, `BEGIN PRIVATE KEY`, `password.*=.*"`.

Spotted a leak in tree? Flag it first — rotation of the underlying credential is the real fix.

## Backlog policy

The "Backlog" section at the bottom of TODO.md is explicitly deferred. **Do not implement or test those items unless the user names one and says "go work on X".**

## Windows console-flash pitfall (Windows-only)

The GUI parent ships with `windows_subsystem = "windows"` (`src-tauri/src/main.rs:2`) and therefore has no console of its own. Two recurring traps follow:

- **Place the `windows_subsystem` attribute on the binary root, never on `lib.rs`.** The inner attribute is silently accepted by Rust on `lib.rs` but has zero effect on the binary's PE subsystem header — the release `.exe` then ships as a console-subsystem program and pops a console for the *parent* process. Adding `CREATE_NO_WINDOW` to child spawns cannot fix this. (`sqlui-native` regressed on this at v3.1.9 — same trap, same fix.) A `cargo test` (`windows_subsystem_attribute_lives_on_binary_root` in `src-tauri/src/lib.rs`) fails the build if it drifts.
- **Route every console-program child spawn through `crate::win_cmd::hidden_command(program)`** — not bare `std::process::Command::new(program)`. The helper pre-applies the Win32 `CREATE_NO_WINDOW` (`0x08000000`) creation flag on Windows and is a `Command::new(...)` no-op on macOS / Linux. Skiffsync's `cprepo` shelling out to `git ls-files` (`sync/repo.rs`) is the recurring offender — every invocation would otherwise flash. A `cargo test` (`no_bare_console_spawns_in_production_code`) scans production source for bare `Command::new("git" | "powershell" | "reg")` and fails the build if one slips in. Extend the test's file list if a new production spawn site lands. **Exception**: the user-initiated "Open Terminal here" action in `commands.rs::fs_open_in_terminal` runs `cmd /K` because the user *wants* a terminal — leave that alone (the test excludes it).
- **Scope: Windows-only.** Both `windows_subsystem` (PE header) and `CREATE_NO_WINDOW` (creation flag) are Win32 abstractions. macOS and Linux do not auto-allocate a terminal for child processes — a GUI parent launched from Finder / `.desktop` / app launcher has no controlling terminal, child stdio inherits null fds, and no window appears.

## Footgun checklist (full context in DEV.md)

- No `window.alert` / `confirm` / `prompt` — Tauri webview suppresses them; use modal dialogs.
- Don't define React components inline inside another component.
- Skiffsync `start_*` returns when QUEUED — for one-shot copies use sync `fs_copy_recursive`.
- Settings persist effect must dedup by VALUE (not ref) or it loops via the cross-window event.
- Continuous gestures: drag-then-commit, not `update()` per mousemove.
- `e.key` is layout-dependent — use `e.code` for symbol keys.
- macOS TCC blocks parts of `$HOME` (`~/.Trash`, `~/Library/Mail`) — route to OS-default handler.
- Virtualize every list-shaped surface, including grids.
- Multi-window settings sync via `settings:changed` Tauri event + focus reload.
- Saved-data types ship with all five surfaces (sidebar / drag / right-click / palette / Settings) — see ARCHITECTURE.md.
- Rebindable shortcuts go through `matchesCombo(e, activeCombo(...))`, not raw `e.key`.
- Cross-component actions go through window CustomEvents (`skiff:*`), not prop-drilling.
- New fs verbs go through `dispatchByLocation(path, { local, remote })` in `src/api/client.ts` — never hand-roll a `if (kind === "sftp" || …)` branch per verb. See ARCHITECTURE.md → "Routing model" for the contract.

UI affordances: smoke-test in `npx tauri dev` and watch the pixels change. Typecheck + Vitest pass on bindings that don't flow through.

## Git / PR

- Squash-merge PRs only (`gh pr merge --squash`). Sync branches with `git merge origin/main`, never rebase shared branches.
- GitHub raw URLs: `https://github.com/{owner}/{repo}/blob/head/{path}?raw=1`. Never `api.github.com/.../contents/` or `raw.githubusercontent.com`.
- Remote is `synle/skiff-files` (local folder name `skiff-file-explorer` differs — always resolve via `git remote get-url origin`).
