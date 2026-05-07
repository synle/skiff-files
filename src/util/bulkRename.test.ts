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

  it("expands {n} in the replace field as a 1-based sequence", () => {
    const out = applyBulkRename(
      ["a.txt", "b.txt", "c.txt"],
      ".+",
      "img-{n}",
      true,
    );
    expect(out.map((r) => r.newName)).toEqual([
      "img-1",
      "img-2",
      "img-3",
    ]);
  });

  it("expands {n:NN} with zero-padding", () => {
    const out = applyBulkRename(
      ["a", "b", "c"],
      ".+",
      "shot-{n:03}",
      true,
    );
    expect(out.map((r) => r.newName)).toEqual([
      "shot-001",
      "shot-002",
      "shot-003",
    ]);
  });

  it("respects sequenceStart option", () => {
    const out = applyBulkRename(["a"], ".+", "x-{n}", true, {
      sequenceStart: 42,
    });
    expect(out[0].newName).toBe("x-42");
  });

  it("prepends a prefix to every entry", () => {
    const out = applyBulkRename(["a.txt", "b.txt"], "", "", false, {
      prefix: "2026-",
    });
    expect(out.map((r) => r.newName)).toEqual([
      "2026-a.txt",
      "2026-b.txt",
    ]);
  });

  it("inserts suffix before the extension by default", () => {
    const out = applyBulkRename(["a.txt"], "", "", false, { suffix: "-edit" });
    expect(out[0].newName).toBe("a-edit.txt");
  });

  it("appends suffix after the extension when suffixBeforeExt=false", () => {
    const out = applyBulkRename(["a.txt"], "", "", false, {
      suffix: "-edit",
      suffixBeforeExt: false,
    });
    expect(out[0].newName).toBe("a.txt-edit");
  });

  it("dotfile (leading-only dot) gets suffix appended at the end", () => {
    const out = applyBulkRename([".env"], "", "", false, { suffix: ".bak" });
    // Leading-only dot is part of the name, not an extension.
    expect(out[0].newName).toBe(".env.bak");
  });

  it("combines find/replace + prefix + suffix in one shot", () => {
    const out = applyBulkRename(["IMG_001.jpg"], "IMG_", "", false, {
      prefix: "p-",
      suffix: "-edit",
    });
    expect(out[0].newName).toBe("p-001-edit.jpg");
  });

  it("no-op when find empty AND no prefix/suffix/etc.", () => {
    const out = applyBulkRename(["a.txt"], "", "", false);
    expect(out[0].changed).toBe(false);
  });
});
