# Test coverage

CI runs both **frontend (Vitest, v8 provider)** and **Rust (cargo-llvm-cov)** coverage in a dedicated `coverage` job in [`.github/workflows/build.yml`](./.github/workflows/build.yml). Numbers post to the run's step summary; full HTML / lcov reports ship as a `coverage-reports` artifact.

**Floors are never hardcoded here** — they ratchet up over time. Sources of truth:

- **Frontend**: `vite.config.ts → test.coverage.thresholds` (`lines` / `statements` / `branches` / `functions`). Vitest's `--coverage` fails the run when any falls below its floor.
- **Rust**: `--fail-under-lines` / `--fail-under-functions` / `--fail-under-regions` passed inline to `cargo llvm-cov` in [`build.yml`](./.github/workflows/build.yml).

## Policy

- **Floors sit 1pt below the current baseline** as a safety margin against coincidental flakes.
- **Raise the floors as coverage improves.** Shipping a feature that pushes a number meaningfully above its floor → bump the floor too. That's how the ratchet stays useful.
- **Never lower the floors** to make a build pass. If coverage genuinely regressed, add the missing tests.

## Running locally

```bash
# Frontend coverage (matches the CI invocation)
npm run test:coverage

# Rust coverage
cd src-tauri
cargo llvm-cov --lib --summary-only
```

`cargo llvm-cov` needs `llvm-tools-preview`. With `rustup`: `rustup component add llvm-tools-preview`. On Homebrew Rust (no rustup), point at Apple's bundled LLVM via env vars:

```bash
export LLVM_COV=/Library/Developer/CommandLineTools/usr/bin/llvm-cov
export LLVM_PROFDATA=/Library/Developer/CommandLineTools/usr/bin/llvm-profdata
```

HTML reports land in `coverage/` (frontend) and `src-tauri/target/llvm-cov-target/html/` (Rust) — both gitignored.
