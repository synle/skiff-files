# TODO.eslint — oxlint baseline & punch list

> Handoff doc for a future cleanup agent. Oxlint (v1.79.0) shipped in 0.2.318–0.2.320 with a
> deliberately conservative baseline: **correctness rules gate CI, everything advisory is warn-only**.
> The goal of this file is to record every rule we enabled / disabled / downgraded and why, plus the
> concrete sites that must be fixed before those downgrades can be reverted.

## Current setup

- Tool: `oxlint` v1.79.0 (devDependency) — same Oxc family as `oxfmt` (the formatter).
- Config: [`.oxlintrc.json`](./.oxlintrc.json)
- Scripts: `npm run lint` (check), `npm run lint:fix` (auto-fix).
- CI: `.github/workflows/build.yml` runs `npm run lint` on every matrix job before tests.
- Gate policy: **errors fail CI; warnings do not.** Today: 0 errors, ~150 warnings.

## Categories

| Category    | Severity | Notes                                        |
| ----------- | -------- | -------------------------------------------- |
| correctness | error    | CI-gating. Currently clean — keep it that way. |
| suspicious  | warn     | Advisory.                                    |
| perf        | warn     | Advisory.                                    |

Plugins: `unicorn`, `typescript`, `react`.

## Rules disabled outright

| Rule                      | Why                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `react/react-in-jsx-scope` | Repo uses the automatic JSX runtime (`tsconfig.json` → `jsx: "react-jsx"`). React never needs to be in scope; every finding is a false positive. Do not re-enable unless the JSX transform changes. |

## Rules downgraded error → warn (revert once the sites are fixed)

These flag real patterns but fixing them is a behavior-sensitive refactor, not lint cleanup.
Each entry lists the fix strategy and every current site.

### 1. `react/set-state-in-effect` (~30 sites)

Dialogs sync props → state on open via `useEffect(() => setState(initial), [open])`. That's the
classic controlled-dialog reset pattern this rule bans. Fix per site by either deriving during render
(`key={open ? 'a' : 'b'}` remount trick or computed state), initializing in `useState(initialValue)`,
or moving the write into the event that opens the dialog.

Sites: `src/pages/SettingsPage.tsx:350`, `src/pages/SettingsPage.tsx:966`,
`src/pages/PreviewWindow.tsx:45`, `src/pages/PreviewWindow.tsx:72`,
`src/pages/ConnectionsPage.tsx:104`, `src/theme/index.ts:64`,
`src/components/ArchiveViewerDialog.tsx:52`, `src/components/BulkRenameDialog.tsx:56`,
`src/components/CommandPalette.tsx:51`, `src/components/CommandPalette.tsx:70`,
`src/components/DiffDialog.tsx:49`, `src/components/GalleryThumb.tsx:103`,
`src/components/NewEntryDialog.tsx:70`, `src/components/OperationsDrawer.tsx:181`,
`src/components/PathPickerField.tsx:106`, `src/components/PreviewPane.tsx:467`,
`src/components/PreviewPane.tsx:517`, `src/components/PreviewPane.tsx:648`,
`src/components/PropertiesDialog.tsx:56`, `src/components/QuickJump.tsx:90`,
`src/components/QuickJump.tsx:111`, `src/components/RemoteConnectDialog.tsx:228`,
`src/components/RemoteConnectDialog.tsx:348`, `src/components/RenameDialog.tsx:63`,
`src/components/preview/MediaBody.tsx:68`, `src/components/preview/TextBody.tsx:117`,
`src/components/preview/TextBody.tsx:151`.

### 2. `react/static-components` + `react/no-unstable-nested-components` (~25 sites)

Components defined inside render (mostly MUI icon wrappers and row renderers). They remount every
render, dropping child state. Fix = hoist the component to module scope and pass data via props.

Sites: `src/components/BulkActionBar.tsx:96,163,171,178,185,193,196,199,206,209,217,261`,
`src/components/Sidebar.tsx:645,686,913,1103,1243,1379,1520,1626`,
`src/pages/SettingsPage.tsx:655,722,732,742,753`.

### 3. `react-hooks/exhaustive-deps` + `react/exhaustive-effect-dependencies` (~8 sites)

Missing deps = stale-closure risk; extra deps = wasted effect runs. Each needs an individual look —
adding a dep can change when the effect fires (behavior change), so no blanket autofix.

Sites: `src/App.tsx:244` (missing `settings.macosFdaPromptDismissed`),
`src/components/FileList.tsx:311` (missing `entry.name`, `entry.isDir`),
`src/components/FileList.tsx:318`, `src/components/FileList.tsx:1263` (`colWidth` unstable),
`src/components/RemoteConnectDialog.tsx:350`, `src/components/preview/TextBody.tsx:612`,
`src/components/preview/MediaBody.tsx:120,128`, `src/pages/SettingsPage.tsx:475`,
`src/pages/ConnectionsPage.tsx:111`.

### 4. `react/refs` (1 site)

`src/components/OperationsDrawer.tsx:240` reads `ref.current` during render. Fix = read it inside an
effect/handler and mirror into state.

### 5. `react/immutability` (1 site)

`src/state/settings.test.tsx:255` mutates an outer-scope variable (`__persistProbe`) from a
component. Test-only probe harness; fix = make the probe a proper store or use refs.

## Advisory warnings left as-is (warn, non-gating)

Not disabled — they're visible noise until someone works through them:

- `eslint/no-await-in-loop` (~20 sites) — mostly **intentional sequential awaits** (paste flow,
  bulk rename, event drain loops). Parallelizing would change semantics; audit each before "fixing".
- `eslint/no-unmodified-loop-condition` (4 sites, all in test polling loops).
- `unicorn/no-array-sort` / `no-array-reverse` (~15 sites) — safe mechanical migration to
  `toSorted()` / `toReversed()`.
- `unicorn/consistent-function-scoping` (~18 sites) — helpers defined near usage for readability;
  hoisting is cosmetic.
- `eslint/no-shadow` (~14 sites, mostly tests re-declaring mocked imports).
- `eslint/no-underscore-dangle` (5 sites) — deliberate `_reset*ForTests` / `__testing__`
  conventions; add to the rule's `allow` list instead of renaming.
- `react/no-array-index-key` (3 sites: `DiffDialog.tsx:101,121`, `Toolbar.tsx:306`) — lists are
  static per render; fine until they aren't.
- `react/no-object-type-as-default-prop` (1 site: `KindFilterBar.tsx:68`) — hoist the default array.
- `unicorn/prefer-add-event-listener` (1 site: `api/drag.ts:52`).

## Suggested order of attack

1. `unicorn/no-array-sort` / `no-array-reverse` → mechanical, zero-risk, clears ~15 warnings.
2. `no-underscore-dangle` allow-list → config-only, clears 5.
3. `static-components` / `no-unstable-nested-components` → hoisting, medium risk, biggest win.
4. `set-state-in-effect` → per-dialog refactor, highest care needed; do one dialog at a time with its
   existing tests as the safety net.
5. Deps arrays + `refs` + `immutability` last — each needs individual reasoning.

After each batch: flip the rule back to `"error"` in `.oxlintrc.json` so it stays fixed.
