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
- **SFTP integration tests** are not currently exercised in CI — the docker harness lands in Phase 3. The Rust-side SFTP tests cover the parts that don't need a server (config parsing, attribute-to-Entry mapping).

---

## Common gotchas

- **MUI v9 dropped `inputProps`** — use `slotProps={{ htmlInput: { ... } }}` or `slotProps={{ input: { ... } }}`. Legacy MUI v8 docs lie.
- **`@mui/icons-material` barrel imports** trip EMFILE on CI. Always import deep: `import Folder from "@mui/icons-material/Folder"`. We had to fix this once already (see `97a9fa0`).
- **Zombie vitest workers** can stack up if a test loops infinitely. `pkill -9 -f vitest` clears them.
- **Settings persist via localStorage** in tests + browser dev mode, and `app_data_dir/settings.json` in the real Tauri runtime. Tests that mutate settings should `localStorage.clear()` in `beforeEach` to avoid leak between bodies.

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
