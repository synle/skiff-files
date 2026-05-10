// i18n scaffold for Skiff Files.
//
// Single-resource (English) bootstrap today. The structure is in
// place so future locales drop in by:
//   1. Adding `src/i18n/<locale>.ts` mirroring the en.ts shape.
//   2. Registering it in the `resources` map below.
//   3. Optionally exposing it in the Settings → Language picker
//      (consumes `Settings.language` from `state/settings.tsx`).
//
// Why no detection / loader plugins yet: we want the scaffold to add
// near-zero bundle weight + zero startup async work. Locale picking
// happens synchronously from the persisted `Settings.language`
// string, which the Settings store seeds from localStorage on first
// paint.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";

/** Registered locales. Adding a translation file here is enough to
 *  make it selectable from Settings → Appearance → Language. */
export const resources = {
  en: { translation: en },
} as const;

/** Locale codes we ship a bundle for. Settings → Language renders
 *  these as a dropdown; any other value in `Settings.language`
 *  falls back to English at lookup time via i18next's `fallbackLng`. */
export type LocaleCode = keyof typeof resources;
export const SUPPORTED_LOCALES: LocaleCode[] = Object.keys(
  resources,
) as LocaleCode[];

/** Initialize i18next once at module-import time. Idempotent — calling
 *  this from multiple entry points (main.tsx + tests) is safe. */
let initialized = false;
export function initI18n(language: string = "en"): typeof i18n {
  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: "en",
      // We don't escape interpolation values — React already
      // escapes children at render time, so double-escaping here
      // produces visible "&amp;" in strings with literals.
      interpolation: { escapeValue: false },
      // Returning the key on missing-translation makes the missing
      // string visible during development without throwing.
      returnNull: false,
    });
    initialized = true;
  } else {
    // Subsequent calls just switch language — useful when the
    // Settings → Language picker fires.
    void i18n.changeLanguage(language);
  }
  return i18n;
}

export default i18n;
