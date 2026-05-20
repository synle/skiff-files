// Markdown renderer + sanitizer tests.
//
// Goals: assert (a) standard Markdown actually renders, (b) the
// sanitizer drops every dangerous tag / attribute / scheme we care
// about. Failure here would let arbitrary file content inject script
// tags or `javascript:` URLs through the preview surface.
import { describe, expect, it } from "vitest";
import { renderMarkdown, sanitizeHtml } from "./markdown";

describe("renderMarkdown", () => {
  it("renders headings + paragraphs + emphasis", () => {
    const html = renderMarkdown("# Title\n\nHello **world**.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>world</strong>");
  });
  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    // The exact wrapping varies between `marked` versions but the
    // class should still flag the language for downstream styling.
    expect(html).toMatch(/<pre><code class="language-js">/);
  });
  it("renders GFM tables", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const html = renderMarkdown(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
  });
});

describe("sanitizeHtml", () => {
  it("strips raw <script> tags but preserves their text", () => {
    const out = sanitizeHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("hi");
  });
  it("strips on* attributes", () => {
    const out = sanitizeHtml('<a href="#" onclick="evil()">x</a>');
    expect(out).not.toContain("onclick");
  });
  it("rejects javascript: URLs in href", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });
  it("rejects vbscript:/data:text URLs in src", () => {
    const out = sanitizeHtml(
      '<img src="vbscript:msgbox(1)" alt="x"><img src="data:text/html,<x>" alt="y">',
    );
    expect(out).not.toContain("vbscript:");
    // data: URLs other than image/* are dropped.
    expect(out).not.toContain("data:text/html");
  });
  it("allows http/https/mailto/relative URLs", () => {
    const out = sanitizeHtml(
      '<a href="https://example.com">x</a><a href="mailto:a@b.c">y</a><a href="/path">z</a>',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('href="mailto:a@b.c"');
    expect(out).toContain('href="/path"');
  });
  it("allows inline data:image/png URLs in img src", () => {
    const tiny =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAACklEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
    const out = sanitizeHtml(`<img src="${tiny}" alt="x">`);
    expect(out).toContain("data:image/png;base64,");
  });
  it("strips disallowed tags like iframe entirely", () => {
    const out = sanitizeHtml('<iframe src="https://x"></iframe><p>ok</p>');
    expect(out).not.toContain("<iframe");
    expect(out).toContain("<p>ok</p>");
  });
});
