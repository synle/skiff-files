# Test coverage

The CI runs both **frontend (Vitest, v8 provider)** and **Rust (cargo-llvm-cov)** coverage in a dedicated `coverage` job in [`.github/workflows/build.yml`](./.github/workflows/build.yml). The numbers are posted to the run page's step summary so you can see them without digging through logs; the full HTML / lcov reports ship as a `coverage-reports` artifact for per-file drill-down.

## Baseline (0.2.250)

Captured against the current test suite minus `src/App.test.tsx` (pre-existing hang — see DEV.md footguns).

### Frontend

| Metric | Baseline | CI floor |
|---|---|---|
| Lines | **39.71%** | 38 |
| Statements | **38.06%** | 37 |
| Branches | **35.91%** | 34 |
| Functions | **31.66%** | 30 |

Floors live in `vite.config.ts → test.coverage.thresholds`. Vitest's `--coverage` flag fails the run when any of the four falls below its floor.

### Rust

| Metric | Baseline | CI floor |
|---|---|---|
| Regions | **54.43%** | 54 |
| Functions | **42.97%** | 42 |
| Lines | **52.85%** | 52 |

Floors are passed inline to `cargo llvm-cov` via `--fail-under-lines` / `--fail-under-functions` / `--fail-under-regions` in [`build.yml`](./.github/workflows/build.yml).

## Policy

- **Floors are pinned 1pt below the baseline** as a safety margin against coincidental flakes (a single newly-added file with a missing test would otherwise tip the totals across an exact-match boundary).
- **Raise the floors as coverage improves.** When you ship a feature that pushes any number meaningfully above its current floor, bump the floor too — that's how the ratchet stays useful.
- **Never lower the floors** to make a build pass. If coverage genuinely regressed, the right answer is to add the missing tests.

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

The HTML reports land in `coverage/` (frontend) and `src-tauri/target/llvm-cov-target/html/` (Rust) — both gitignored.
