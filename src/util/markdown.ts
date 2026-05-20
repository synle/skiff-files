// Markdown → safe HTML wrapper.
//
// `marked` does the parse; we configure it with the conservative
// defaults that suit a file-explorer preview: GFM (tables, fenced
// blocks, strikethrough), break-on-newline OFF (single-newlines are
// soft wraps in real Markdown — the user's source intent), and the
// async pipeline DISABLED (Tauri's webview can't fetch over the
// `tauri://` scheme so any extension that defers via promises would
// hang).
//
// Sanitization: `marked` itself does NOT escape inline HTML — the
// upstream rationale is "Markdown allows HTML, by design." For a
// preview of files the user already owns on disk that's defensible,
// but content from network-mounted backends (SFTP / SMB) is not
// trusted enough to splat raw HTML into the DOM. We post-process the
// rendered HTML through a tiny allowlist sanitizer below so the
// rendered output cannot inject script tags, inline-event handlers,
// or `javascript:` URLs.
import { marked } from "marked";

// One-time configuration shared by every render. Mutating per-call
// would race with concurrent renders; setting once at module load
// keeps the parser deterministic.
marked.use({
  gfm: true,
  breaks: false,
  async: false,
});

/** Convert markdown source to a sanitized HTML string. The output is
 *  safe to drop into `dangerouslySetInnerHTML` — see the sanitizer
 *  below for the allowlist. */
export function renderMarkdown(source: string): string {
  // `marked.parse` returns a `string | Promise<string>` only because
  // `async` mode is supported. We configured `async: false` above,
  // so the runtime type is always string — cast safely.
  const raw = marked.parse(source) as string;
  return sanitizeHtml(raw);
}

// Sanitizer — a tiny allowlist-based pass over the parsed HTML.
// Why roll-our-own instead of pulling in DOMPurify: DOMPurify is
// ~50 KB minified and ships its own dependency surface. The output
// of `marked` is constrained (no script tags emitted by the
// renderer, no inline event attributes), so the residual risk is:
//   1. User's markdown source includes literal `<script>`, `<iframe>`,
//      `<object>`, etc. inline HTML — marked passes these through.
//   2. Any tag carries `on*` handler attributes — marked passes
//      these through too.
//   3. `<a href="javascript:...">` or `<img src="javascript:...">`.
// The allowlist below handles all three.
const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "input", // task-list checkbox — readOnly forced below
  "span",
  "div",
]);
const ALLOWED_ATTRS_PER_TAG: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title"]),
  input: new Set(["type", "checked", "disabled"]),
  th: new Set(["align"]),
  td: new Set(["align"]),
  code: new Set(["class"]), // language-foo from fenced blocks
  pre: new Set(["class"]),
  span: new Set(["class"]),
  div: new Set(["class"]),
};

/** Allowlist-sanitize a small HTML string. Uses a DOMParser when
 *  available; falls back to returning escaped text in non-browser
 *  environments (so unit tests under node still get safe output).
 *  Anchor + image URLs go through `safeUrl` which rejects
 *  `javascript:` / `vbscript:` / `data:` (except `data:image/`). */
export function sanitizeHtml(input: string): string {
  if (typeof DOMParser === "undefined") {
    // jsdom-less SSR/test fallback — should not happen in the app
    // proper. Returning escaped text is the conservative behavior.
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  const doc = new DOMParser().parseFromString(
    `<div id="root">${input}</div>`,
    "text/html",
  );
  const root = doc.getElementById("root");
  if (!root) return "";
  scrub(root);
  return root.innerHTML;
}

function scrub(node: Element): void {
  // Walk children first so we don't mutate the live list while iterating.
  // Snapshot to an array, then process — removeChild rewires siblings.
  const kids = Array.from(node.children);
  for (const child of kids) {
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Replace the disallowed element with a text node holding its
      // textContent so the markdown's natural-language content is
      // preserved while its tag goes away. This is friendlier than
      // dropping the whole subtree, which would lose user content.
      const textNode = node.ownerDocument!.createTextNode(
        child.textContent ?? "",
      );
      node.replaceChild(textNode, child);
      continue;
    }
    // Strip every attribute except the per-tag allowlist.
    const allowedAttrs = ALLOWED_ATTRS_PER_TAG[tag] ?? new Set<string>();
    const attrNames = Array.from(child.attributes).map((a) => a.name);
    for (const name of attrNames) {
      if (!allowedAttrs.has(name)) {
        child.removeAttribute(name);
        continue;
      }
      // Tag-specific value scrubbing.
      if ((tag === "a" || tag === "img") && (name === "href" || name === "src")) {
        const cleaned = safeUrl(child.getAttribute(name) ?? "");
        if (cleaned == null) {
          child.removeAttribute(name);
        } else {
          child.setAttribute(name, cleaned);
        }
      }
    }
    if (tag === "a") {
      // Open external links in a new webview tab — but always with
      // noopener / noreferrer so the linked page can't reach back to
      // window.opener and rewrite our URL.
      child.setAttribute("rel", "noopener noreferrer");
      child.setAttribute("target", "_blank");
    }
    if (tag === "input") {
      // Markdown task lists only — force readOnly so a user click
      // doesn't try to toggle a value we can't persist anywhere.
      child.setAttribute("disabled", "");
    }
    scrub(child);
  }
}

/** Return the URL if it's safe to embed, or null to drop the attribute.
 *  Allows: relative paths, plain http(s), mailto, tel, file, and
 *  data:image/<png|jpeg|gif|webp|svg+xml>;base64. Blocks: javascript:,
 *  vbscript:, every other `data:` shape. */
function safeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Empty schemes (relative URLs, anchors, query strings) are fine.
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("?") ||
    trimmed.startsWith(".")
  ) {
    return trimmed;
  }
  const colon = trimmed.indexOf(":");
  if (colon < 0) return trimmed; // no scheme → relative.
  const scheme = trimmed.slice(0, colon).toLowerCase();
  if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel" || scheme === "file") {
    return trimmed;
  }
  if (scheme === "data") {
    // Only allow inline images, with the conventional content-type
    // + base64 prefix shape. Anything else (data:text/html base64,
    // data:application/javascript, etc.) is rejected.
    if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  return null;
}
