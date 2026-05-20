// Tests for the syntax-highlight helpers.
//
// These guard the (a) language picker mapping common extensions to
// Prism grammars and (b) the highlighter returning escaped output
// when no grammar is registered (so the caller can pass it through
// dangerouslySetInnerHTML without re-escaping).
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  highlightSource,
  pickLanguage,
} from "./syntaxHighlight";

describe("pickLanguage", () => {
  it("maps standard extensions to Prism grammar ids", () => {
    expect(pickLanguage("foo.js")).toBe("javascript");
    expect(pickLanguage("foo.ts")).toBe("typescript");
    expect(pickLanguage("foo.tsx")).toBe("tsx");
    expect(pickLanguage("foo.py")).toBe("python");
    expect(pickLanguage("foo.cpp")).toBe("cpp");
    expect(pickLanguage("foo.java")).toBe("java");
    expect(pickLanguage("foo.xml")).toBe("markup");
    expect(pickLanguage("foo.yaml")).toBe("yaml");
    expect(pickLanguage("foo.json")).toBe("json");
    expect(pickLanguage("foo.go")).toBe("go");
    expect(pickLanguage("foo.rs")).toBe("rust");
  });
  it("handles extensionless conventional filenames", () => {
    expect(pickLanguage("Dockerfile")).toBe("docker");
    expect(pickLanguage("Makefile")).toBe("makefile");
    expect(pickLanguage(".bashrc")).toBe("bash");
    expect(pickLanguage(".gitignore")).toBe("ini");
  });
  it("returns null for unrecognized extensions", () => {
    expect(pickLanguage("foo.unknownext")).toBeNull();
    expect(pickLanguage("foo")).toBeNull();
  });
  it("is case-insensitive on extensions", () => {
    expect(pickLanguage("Foo.JS")).toBe("javascript");
    expect(pickLanguage("BAR.PY")).toBe("python");
  });
});

describe("highlightSource", () => {
  // We don't assert Prism's exact span-class output because the
  // per-language components register against a `global.Prism` set
  // up by the main `prismjs` import — under vitest's transform
  // pipeline that side-effect doesn't reliably fire before the
  // helper imports run. The runtime behavior in the Tauri webview
  // is fine (Prism's UMD wrapper assigns to `window.Prism` at boot
  // and every component lookup hits a populated registry). These
  // tests therefore only assert the fallback contract: when the
  // grammar isn't loaded for whatever reason, the helper must
  // hand back HTML-escaped text so the consumer's
  // `dangerouslySetInnerHTML` stays safe.
  it("returns escaped plain text when language is null", () => {
    const out = highlightSource("<b>hi</b>", null);
    expect(out).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });
  it("returns escaped plain text when grammar is missing", () => {
    // Pass a language id we deliberately don't load.
    const out = highlightSource("<x>", "nonexistent-lang-xyz");
    expect(out).toBe("&lt;x&gt;");
  });
  it("never returns raw HTML even when Prism is unavailable", () => {
    // Sanity check on the safe-by-default property: any path that
    // can't highlight must still escape.
    const out = highlightSource('<script>alert("x")</script>', "javascript");
    expect(out).not.toContain("<script>");
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >, \", '", () => {
    expect(escapeHtml(`& < > " '`)).toBe(`&amp; &lt; &gt; &quot; &#39;`);
  });
});
