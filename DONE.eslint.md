# DONE.eslint — oxlint baseline & punch list (complete)

> **Status: DONE.** The punch list from `TODO.eslint.md` (0.2.320) has been fully worked through
> in 0.2.322. Every rule that was downgraded to warn is now back to **error** severity, the two
> false-positive rules are configured with their rule-specific escape hatches, and `npm run lint`
> exits clean — **0 errors, 0 warnings** across 217 files. This file records the final state and
> what was done, so a future agent doesn't re-litigate it.

## Final setup

- Tool: `oxlint` v1.79.0 (devDependency) — same Oxc family as the `oxfmt` formatter.
- Config: [`.oxlintrc.json`](./.oxlintrc.json)
- Scripts: `npm run lint` (check), `npm run lint:fix` (auto-fix).
- CI: `.github/workflows/build.yml` runs `npm run lint` on every matrix job before tests.
- Gate policy: **errors fail CI; warnings fail nothing because there are none left.**

## Categories

| Category    | Severity | Notes                                    |
| ----------- | -------- | ---------------------------------------- |
| correctness | error    | CI-gating. Clean.                        |
| suspicious  | warn     | Advisory. Clean today.                   |
| perf        | warn     | Advisory. Clean today.                   |

Plugins: `unicorn`, `typescript`, `react`.

## Rules disabled outright (permanent, with reasons)

| Rule                       | Why                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/react-in-jsx-scope` | Repo uses the automatic JSX runtime (`tsconfig.json` → `jsx: "react-jsx"`). React never needs to be in scope; every finding is a false positive. Do not re-enable unless the JSX transform changes. |

## Rule-severity decisions that differ from plain category defaults

| Rule                                     | Severity      | Why                                                                                                                              |
| ---------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `react/no-unstable-nested-components`    | error + `allowAsProps: true` | The rule's own escape hatch: inline arrow props named `onXxx` (e.g. every `onContextMenu`) are event handlers, not components. Genuine nested components stay gated at error level. |
| `eslint/no-underscore-dangle`            | warn + allow list | Deliberate naming conventions: `_resetFolderSizeCacheForTests`, `_resetTrashStackForTests`, `__testing__`, `__persistProbe`. |

## Test-file overrides (`.oxlintrc.json → overrides`)

Stylistic rules that fight idiomatic test structure are off for `*.test.ts` / `*.test.tsx` only:

- `unicorn/consistent-function-scoping` — helpers local to a test are deliberate.
- `eslint/no-shadow` — re-declaring mocked import names inside each test is the mock pattern.
- `eslint/no-unmodified-loop-condition` — act/poll loops flip flags via closures.
- `eslint/no-await-in-loop` — tests await sequential UI updates on purpose.

Production code keeps all four at full strength.

## What was fixed to get here (0.2.322)

1. **`unicorn/no-array-sort` / `no-array-reverse`** (~15 sites) — migrated to `toSorted()` /
   `toReversed()`. `tsconfig` lib bumped ES2022 → ES2023 for the method types.
2. **Nested / static components in render** (~25 sites) — `BulkActionBar.ActionButton`,
   `SettingsPage.SavedDataBlock`, `BrowserTabs.closeWindow`, `EntryContextMenu.shortcut`,
   `Toolbar.sortLabel` / `labelFor`, plus several small helpers hoisted to module scope.
   Per-render recreation dropped; focus/tooltip state survives re-renders now.
3. **`set-state-in-effect`** (~27 sites) — converted the "reset state when dialog opens / target
   changes" pattern to React's documented render-adjust form (`prevKey` comparison + conditional
   setState during render). Async halves of mixed effects (fetches, keychain probes) stayed as
   effects. One genuine false positive (`ConnectionsPage` fire-and-forget async call) carries an
   inline directive with the reason.
4. **Hook dependency arrays** — real fixes instead of suppressions:
   - `App.tsx` FDA probe: mount-once semantics preserved via a `fdaProbeRanRef` guard + explicit
     dep on `settings.macosFdaPromptDismissed`.
   - `FileList` rename-input layout effect: deps added (`entry.isDir`, `entry.name`) — behavior
     identical since the input remounts per rename target.
   - `FileList.colWidth`: memoized so the resize callback identity is stable.
   - `GalleryThumb`: cache-hit fast path moved into render-adjust with a `servedFromCache` flag
     the fetch effect reads (no missing-dep suppression needed).
5. **`react/refs`** — `OperationsDrawer` ETA samples moved from a ref read during render into
   component state.
6. **`react/immutability`** — `settings.test.tsx` probe guard write moved into an effect.
7. **Intentional sequential awaits** (17 production sites) — each carries an inline
   `oxlint-disable-next-line eslint/no-await-in-loop -- <reason>` documenting why serial is
   correct (ordered startup steps, destructive-op ordering, serial paste dispatch).
8. **Misc singles** — `KindFilterBar` default array hoisted to a module constant;
   `drag.ts` Channel `onmessage` directive added (Tauri IPC type, not an EventTarget);
   shadowed params renamed in `BrowserTabs` / `FileList`.

## Verification (0.2.322)

- `npm run lint` → exit 0, zero diagnostics.
- `npm run typecheck` → clean.
- `npm test` → 104 files, 1070/1070 passing.
- `npm run build` (Vite 8 / Rolldown) → green.
- `npm run format:check` → clean.

## Maintenance notes for the next agent

- New code must keep `npm run lint` at zero warnings — warnings are the smoke detector for the
  patterns listed above regressing.
- If you add an intentional sequential-await loop, add the same one-line directive with a reason;
  don't widen it to a file-level disable.
- If a dialog needs new "reset on open" fields, follow the existing render-adjust pattern in
  `RenameDialog` / `NewEntryDialog` rather than adding a reset effect.
- The `no-underscore-dangle` allow list and the test-file overrides are the only standing
  exceptions — extend them deliberately, never by convenience.
