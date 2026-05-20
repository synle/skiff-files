// Tests for the in-body search engine + the markdown / raw toggle +
// the search bar. Keeps focused on `computeMatches` (the algorithm)
// + a couple of integration checks that the toolbar wiring lights
// the right modes.
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import TextBody, { computeMatches } from "./TextBody";
import { themeFor } from "../../theme";
import type { Entry } from "../../api/fs";
import { vi } from "vitest";

vi.mock("../../api/client", () => ({
  readText: vi.fn(async (path: string) => {
    if (path === "/x/notes.md")
      return "# Title\n\nHello world. world repeats.\nworld again.";
    if (path === "/x/code.ts")
      return "const greeting = 'hello world';\nfunction sayHi() { return greeting; }";
    return "";
  }),
  // Not used in this file but TextBody pulls from the same module
  // surface — leave as no-ops so the import resolves.
  readBase64: vi.fn(async () => ""),
}));

const mkEntry = (overrides: Partial<Entry> = {}): Entry => ({
  name: "notes.md",
  path: "/x/notes.md",
  kind: "markdown",
  size: 200,
  mtime: null,
  isDir: false,
  isSymlink: false,
  isHidden: false,
  mode: null,
  ...overrides,
});

const r = (entry: Entry) =>
  render(
    <ThemeProvider theme={themeFor("light")}>
      <TextBody entry={entry} />
    </ThemeProvider>,
  );

describe("computeMatches", () => {
  it("returns empty for an empty query", () => {
    expect(computeMatches("hello world", "", "contains", false)).toEqual([]);
  });
  it("finds every substring occurrence (contains, case-insensitive)", () => {
    const hits = computeMatches("Foo foo FOO bar", "foo", "contains", false);
    expect(hits).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });
  it("respects case sensitivity", () => {
    const hits = computeMatches("Foo foo", "foo", "contains", true);
    expect(hits).toEqual([[4, 7]]);
  });
  it("supports exact-word matching", () => {
    const hits = computeMatches("foobar foo foo.", "foo", "exact", false);
    // The "foobar" hit should NOT match because there's no word
    // boundary after the third character.
    expect(hits).toEqual([
      [7, 10],
      [11, 14],
    ]);
  });
  it("supports regex matching", () => {
    const hits = computeMatches("a12 b34 c56", "[a-z]\\d+", "regex", false);
    expect(hits).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });
  it("returns empty for malformed regex (instead of throwing)", () => {
    const hits = computeMatches("hello", "[", "regex", false);
    expect(hits).toEqual([]);
  });
  it("handles zero-width regex without infinite-looping", () => {
    // `^` matches at position 0; the implementation must bump
    // lastIndex to avoid spinning forever on global zero-width
    // matches.
    const hits = computeMatches("ab", "^", "regex", false);
    expect(hits).toEqual([]);
  });
});

describe("TextBody integration", () => {
  it("renders markdown source RAW when toggle is flipped", async () => {
    r(mkEntry());
    const rawBtn = await screen.findByRole("button", {
      name: /View raw markdown source/i,
    });
    fireEvent.click(rawBtn);
    // The raw view shows the literal `#` prefix; the rendered view
    // would have promoted it into an <h1>.
    await waitFor(() => {
      expect(screen.getByText(/# Title/)).toBeInTheDocument();
    });
  });
  it("opens the search bar via the toolbar icon", async () => {
    r(mkEntry({ name: "code.ts", path: "/x/code.ts", kind: "code" }));
    const searchBtn = await screen.findByRole("button", {
      name: /Search in file/i,
    });
    fireEvent.click(searchBtn);
    await waitFor(() => {
      expect(screen.getByLabelText(/Search text in preview/i)).toBeInTheDocument();
    });
  });
  it("shows a `n / m` counter that reflects the active match", async () => {
    r(mkEntry());
    // Switch to raw markdown so matches operate on the literal
    // source text (the rendered view turns `world` into a child of
    // various tags and the overlay only highlights raw-text spans).
    const rawBtn = await screen.findByRole("button", {
      name: /View raw markdown source/i,
    });
    fireEvent.click(rawBtn);
    const searchBtn = await screen.findByRole("button", {
      name: /Search in file/i,
    });
    fireEvent.click(searchBtn);
    const input = await screen.findByLabelText(/Search text in preview/i);
    fireEvent.change(input, { target: { value: "world" } });
    await waitFor(() => {
      // Three occurrences in the fixture text.
      expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
    });
    // Next button advances the active hit.
    fireEvent.click(screen.getByRole("button", { name: /Next match/i }));
    await waitFor(() => {
      expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();
    });
  });
});
