// Pure resolver for the BulkActionBar's dense / labeled state. Lives
// in `util/` so it can be unit-tested without a React render — the
// Settings → "Action bar labels" dropdown writes into
// `bulkActionBarLabels`, and `Browser.tsx` calls this helper to turn
// the three-mode value + the current pane mode into the boolean the
// `BulkActionBar` `dense` prop expects.

/** Mirror of `Settings["bulkActionBarLabels"]`. */
export type BulkActionBarLabels = "auto" | "labels" | "icons";

/** Resolve the dense (icon-only + tooltip) vs labeled (icon + text)
 *  state. Three rules:
 *  - `"icons"`  → always dense.
 *  - `"labels"` → never dense.
 *  - `"auto"`   → dense when two-pane mode is on (labels would
 *                 otherwise wrap at half-width), labeled otherwise.
 *
 *  Bug 6 regression — this fn replaces the inline ternary previously
 *  baked into `Browser.tsx`'s `BulkActionBar` callsite. Tested in
 *  `bulkActionBarMode.test.ts`. */
export function resolveBulkActionBarDense(
  mode: BulkActionBarLabels,
  twoPaneMode: boolean,
): boolean {
  if (mode === "icons") return true;
  if (mode === "labels") return false;
  return twoPaneMode;
}
