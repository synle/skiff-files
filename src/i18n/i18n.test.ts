// Tiny smoke test for the i18n scaffold. We assert:
//   1. `initI18n` resolves a known key in English to the expected
//      string (the bundle is wired up).
//   2. Switching language via `i18n.changeLanguage` returns a
//      translation that equals the English fallback (since "fr"
//      isn't shipped, fallbackLng kicks in instead of returning
//      the raw key).
import { describe, it, expect } from "vitest";
import i18n, { initI18n, SUPPORTED_LOCALES } from ".";

describe("i18n scaffold", () => {
  it("resolves an English key", () => {
    initI18n("en");
    expect(i18n.t("sidebar.nav.settings")).toBe("Settings");
    expect(i18n.t("sidebar.section.favorites")).toBe("Favorites");
  });

  it("falls back to English for unsupported locale codes", () => {
    initI18n("fr");
    // Even though "fr" isn't registered, fallbackLng = "en" picks up.
    expect(i18n.t("sidebar.nav.transfers")).toBe("Transfers");
  });

  it("ships at least the English bundle", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
  });
});
