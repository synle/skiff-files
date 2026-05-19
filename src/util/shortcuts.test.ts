import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "./shortcuts";

describe("SHORTCUT_GROUPS", () => {
  it("exposes the documented group titles in display order", () => {
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual([
      "Navigation",
      "Selection",
      "Search",
      "View",
      "Tabs",
      "Help",
    ]);
  });

  it("has at least one shortcut in each group", () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("every rebindable entry pairs an actionId with a defaultCombo", () => {
    for (const g of SHORTCUT_GROUPS) {
      for (const s of g.items) {
        if (s.actionId !== undefined) {
          expect(typeof s.actionId).toBe("string");
          expect(s.actionId.length).toBeGreaterThan(0);
          expect(typeof s.defaultCombo).toBe("string");
          expect(s.defaultCombo!.length).toBeGreaterThan(0);
          // Combos are stored lowercase + `+`-joined per keybindings.ts.
          expect(s.defaultCombo).toBe(s.defaultCombo!.toLowerCase());
        }
      }
    }
  });

  it("includes the nine generated tabs.switchToN bindings", () => {
    const tabsGroup = SHORTCUT_GROUPS.find((g) => g.title === "Tabs")!;
    const switchActions = tabsGroup.items
      .map((i) => i.actionId)
      .filter((a) => typeof a === "string" && a.startsWith("tabs.switchTo"));
    expect(switchActions.length).toBe(9);
    expect(switchActions).toContain("tabs.switchTo1");
    expect(switchActions).toContain("tabs.switchTo9");
  });

  it("actionIds are unique across the whole catalog", () => {
    const ids: string[] = [];
    for (const g of SHORTCUT_GROUPS) {
      for (const s of g.items) {
        if (s.actionId) ids.push(s.actionId);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  // viewZoom shortcuts (0.2.300) drive the `- 100% +` widget at the
  // bottom-right of FileList. Pin the action IDs + default combos so
  // the App.tsx keydown handler stays in lockstep with the catalog.
  it("includes the three view-zoom rebindable shortcuts", () => {
    const view = SHORTCUT_GROUPS.find((g) => g.title === "View")!;
    const ids = view.items.map((i) => i.actionId);
    expect(ids).toContain("app.viewZoomIn");
    expect(ids).toContain("app.viewZoomOut");
    expect(ids).toContain("app.viewZoomReset");
    const byId = new Map(
      view.items.filter((i) => i.actionId).map((i) => [i.actionId!, i]),
    );
    expect(byId.get("app.viewZoomIn")?.defaultCombo).toBe("cmd+shift+=");
    expect(byId.get("app.viewZoomOut")?.defaultCombo).toBe("cmd+shift+-");
    expect(byId.get("app.viewZoomReset")?.defaultCombo).toBe("cmd+shift+0");
  });
});
