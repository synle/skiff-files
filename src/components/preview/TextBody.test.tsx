// Tests for the in-body search engine + the markdown / raw toggle +
// the search bar. Keeps focused on `computeMatches` (the algorithm)
// + a couple of integration checks that the toolbar wiring lights
// the right modes.
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import TextBody, {
  computeMatches,
  lineIndexForOffset,
  overlayMatches,
  overlayMatchesInLine,
} from "./TextBody";
import { themeFor } from "../../theme";
import type { Entry } from "../../api/fs";
import { vi } from "vitest";

// A fixture that comfortably exceeds the 64 KB VIRTUAL_BYTES gate
// inside TextBody so the integration tests can exercise the
// virtualized renderer branch. ~70 KB of repeated "line" text.
const LARGE_FIXTURE_LINES = 5000;
const LARGE_FIXTURE = Array.from(
  { length: LARGE_FIXTURE_LINES },
  (_, i) => `line ${i} world`,
).join("\n");

vi.mock("../../api/client", () => ({
  readText: vi.fn(async (path: string) => {
    if (path === "/x/notes.md")
      return "# Title\n\nHello world. world repeats.\nworld again.";
    if (path === "/x/code.ts")
      return "const greeting = 'hello world';\nfunction sayHi() { return greeting; }";
    if (path === "/x/huge.txt") return LARGE_FIXTURE;
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
  it("wraps the prev / next match around the ends of the list", async () => {
    r(mkEntry());
    const rawBtn = await screen.findByRole("button", {
      name: /View raw markdown source/i,
    });
    fireEvent.click(rawBtn);
    fireEvent.click(
      await screen.findByRole("button", { name: /Search in file/i }),
    );
    const input = await screen.findByLabelText(/Search text in preview/i);
    fireEvent.change(input, { target: { value: "world" } });
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
    });
    // Clicking Previous from index 0 should wrap to the last match
    // (3 of 3) rather than stay put — wrap-around keeps the
    // "find by typing then arrowing" flow ergonomic.
    fireEvent.click(screen.getByRole("button", { name: /Previous match/i }));
    await waitFor(() => {
      expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument();
    });
  });
  it("Esc inside the search input closes the bar", async () => {
    r(mkEntry({ name: "code.ts", path: "/x/code.ts", kind: "code" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Search in file/i }),
    );
    const input = await screen.findByLabelText(/Search text in preview/i);
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/Search text in preview/i),
      ).not.toBeInTheDocument();
    });
  });
  it("disables Copy / search controls until the file has loaded", async () => {
    // Initial render shows the "Loading…" placeholder; toolbar
    // should not be there yet because the hooks-before-early-return
    // refactor still gates the body on text !== null.
    r(mkEntry());
    expect(screen.getByText(/Loading…/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy file contents/i })).toBeNull();
    // After text resolves, the toolbar renders.
    await screen.findByRole("button", { name: /Copy file contents/i });
  });
  it("clicking Copy file contents writes the text to the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    r(mkEntry());
    fireEvent.click(
      await screen.findByRole("button", { name: /Copy file contents/i }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    // The first arg is the full text — markdown raw source, since
    // copying happens against the underlying text regardless of
    // the rendered toggle (consistent with editors / VS Code).
    const firstCall = writeText.mock.calls[0] as [string];
    expect(firstCall[0]).toContain("Title");
  });
  it("zoom-out / reset / zoom-in step the font size readout", async () => {
    r(mkEntry({ name: "code.ts", path: "/x/code.ts", kind: "code" }));
    // 100% is the initial readout.
    await screen.findByText(/100%/);
    fireEvent.click(screen.getByLabelText(/Zoom text in/i));
    await waitFor(() => {
      // 14 / 12 ≈ 117%
      expect(screen.getByText(/117%/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/Reset text zoom/i));
    await waitFor(() => {
      expect(screen.getByText(/100%/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/Zoom text out/i));
    await waitFor(() => {
      // 10 / 12 ≈ 83%
      expect(screen.getByText(/83%/)).toBeInTheDocument();
    });
  });
  it("renders via the virtualized branch for files past the 64 KB gate", async () => {
    // The huge fixture comfortably exceeds VIRTUAL_BYTES, so
    // TextBody routes through VirtualizedTextView instead of
    // InlineTextView. Differentiating signal: InlineTextView
    // renders a single `<pre class="language-…">`; the virtualized
    // branch does NOT emit that <pre>. jsdom doesn't lay out the
    // viewport so `getVirtualItems()` returns nothing concrete —
    // we assert on the structural difference instead.
    r(
      mkEntry({
        name: "huge.txt",
        path: "/x/huge.txt",
        kind: "text",
        size: LARGE_FIXTURE.length,
      }),
    );
    // Wait for the toolbar to confirm the file has loaded.
    await screen.findByRole("button", { name: /Copy file contents/i });
    // No `<pre>` tag should render — the virtualized branch uses
    // absolutely-positioned `<Box>` rows instead.
    expect(document.querySelector("pre")).toBeNull();
  });
});

describe("overlayMatches", () => {
  it("wraps each match in a <mark> with the right class", () => {
    const html = overlayMatches("foo bar foo", "ignored", [
      [0, 3],
      [8, 11],
    ], 0);
    expect(html).toContain(
      '<mark class="skiff-search-hit skiff-search-hit-active">foo</mark>',
    );
    expect(html).toContain('<mark class="skiff-search-hit">foo</mark>');
    // Inter-match text is preserved verbatim (HTML-escaped).
    expect(html).toContain(" bar ");
  });
  it("escapes inter-match text", () => {
    const html = overlayMatches("<a>foo</a>", "ignored", [[3, 6]], 0);
    expect(html).toContain("&lt;a&gt;");
    expect(html).toContain('<mark class="skiff-search-hit skiff-search-hit-active">foo</mark>');
  });
  it("appends the trailing tail when the last match isn't at end", () => {
    const html = overlayMatches("foo bar", "ignored", [[0, 3]], 0);
    expect(html).toContain(" bar");
  });
});

describe("overlayMatchesInLine", () => {
  it("sorts hits by start offset before splicing", () => {
    // Pass out-of-order hits; the function should sort them.
    const html = overlayMatchesInLine(
      "abcdef",
      [
        [4, 6, 1],
        [0, 2, 0],
      ],
      0,
    );
    expect(html).toBe(
      [
        '<mark class="skiff-search-hit skiff-search-hit-active">ab</mark>',
        "cd",
        '<mark class="skiff-search-hit">ef</mark>',
      ].join(""),
    );
  });
  it("marks the active hit via the active class", () => {
    const html = overlayMatchesInLine(
      "ab cd",
      [
        [0, 2, 0],
        [3, 5, 1],
      ],
      1,
    );
    // The second hit (index 1) carries the active class; the first
    // (index 0) doesn't.
    expect(html).toContain(
      '<mark class="skiff-search-hit skiff-search-hit-active">cd</mark>',
    );
    expect(html).toContain('<mark class="skiff-search-hit">ab</mark>');
  });
});

describe("lineIndexForOffset", () => {
  it("returns the line index for a given offset", () => {
    // Three lines: "abc\n", "de\n", "fghi"
    // Line starts: [0, 4, 7]
    const starts = [0, 4, 7];
    expect(lineIndexForOffset(starts, 0)).toBe(0);
    expect(lineIndexForOffset(starts, 2)).toBe(0);
    expect(lineIndexForOffset(starts, 4)).toBe(1);
    expect(lineIndexForOffset(starts, 5)).toBe(1);
    expect(lineIndexForOffset(starts, 7)).toBe(2);
    expect(lineIndexForOffset(starts, 999)).toBe(2);
  });
  it("returns -1 for an empty line-starts table", () => {
    expect(lineIndexForOffset([], 0)).toBe(-1);
  });
  it("returns -1 for offsets less than the first line's start", () => {
    expect(lineIndexForOffset([5, 10], 0)).toBe(-1);
  });
});
