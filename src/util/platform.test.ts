// Pin the macOS user-agent detection contract so a future tweak to
// the substring rule doesn't silently break the Settings → macOS
// permissions gate (or any other consumer that branches on isMacOs).
import { afterEach, describe, expect, it } from "vitest";
import { isMacOs } from "./platform";

const origUA = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function setUA(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

describe("isMacOs", () => {
  afterEach(() => {
    if (origUA) Object.defineProperty(navigator, "userAgent", origUA);
  });

  it("returns true for macOS WKWebView UA strings", () => {
    setUA(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    );
    expect(isMacOs()).toBe(true);
  });

  it("returns false for Windows UA strings", () => {
    setUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    );
    expect(isMacOs()).toBe(false);
  });

  it("returns false for Linux UA strings", () => {
    setUA(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    expect(isMacOs()).toBe(false);
  });

  it("returns false for iPad UA strings even though they contain Macintosh", () => {
    setUA(
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(isMacOs()).toBe(false);
  });

  it("returns false when the UA is missing the Macintosh marker", () => {
    setUA("Mozilla/5.0 (compatible; CustomBot/1.0)");
    expect(isMacOs()).toBe(false);
  });
});
