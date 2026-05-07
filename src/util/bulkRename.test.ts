import { describe, it, expect } from "vitest";
import { applyBulkRename } from "./bulkRename";

describe("applyBulkRename", () => {
  it("returns unchanged rows when find is empty", () => {
    const out = applyBulkRename(["a.txt", "b.txt"], "", "x", false);
    expect(out.every((r) => !r.changed)).toBe(true);
    expect(out[0].newName).toBe("a.txt");
  });

  it("does literal replacement when regex is off", () => {
    const out = applyBulkRename(
      ["my-file.TXT", "your-file.txt"],
      "file",
      "doc",
      false,
    );
    expect(out.map((r) => r.newName)).toEqual(["my-doc.TXT", "your-doc.txt"]);
    expect(out.every((r) => r.changed)).toBe(true);
  });

  it("escapes regex metacharacters in literal mode", () => {
    const out = applyBulkRename(["a.b", "ab"], ".", "_", false);
    // The dot should match a literal dot only (not "any char"), so
    // "ab" stays unchanged.
    expect(out[0].newName).toBe("a_b");
    expect(out[1].newName).toBe("ab");
    expect(out[1].changed).toBe(false);
  });

  it("uses regex when enabled and supports capture groups", () => {
    const out = applyBulkRename(
      ["IMG_001.jpg", "IMG_002.jpg"],
      "IMG_(\\d+)",
      "photo-$1",
      true,
    );
    expect(out.map((r) => r.newName)).toEqual([
      "photo-001.jpg",
      "photo-002.jpg",
    ]);
  });

  it("surfaces an error per row when the regex is invalid", () => {
    const out = applyBulkRename(["a.txt"], "(unclosed", "x", true);
    expect(out[0].error).toBeTruthy();
    expect(out[0].changed).toBe(false);
  });

  it("reports `changed=false` when the substitution produces the same name", () => {
    // No occurrences of `xyz` in any name → unchanged.
    const out = applyBulkRename(["a.txt", "b.txt"], "xyz", "abc", false);
    expect(out.every((r) => !r.changed)).toBe(true);
  });

  it("replaces every occurrence (global), not just the first", () => {
    const out = applyBulkRename(["a-a-a.txt"], "a", "Z", false);
    expect(out[0].newName).toBe("Z-Z-Z.txt");
  });
});
