// Tiny console wrapper that gates calls against the user's chosen
// `Settings.logLevel`. Components import `log` and call `log.info(...)`
// etc. — when the level is `off` (or below the call's severity) the
// call is a no-op. The level is read fresh per call via a registered
// getter so a runtime toggle takes effect without restarting the app.
//
// SettingsProvider registers `setLogLevelGetter` once on mount; tests
// and pre-mount code use the default ("warn") without crashing.

import type { LogLevel } from "../state/settings";

const RANK: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let getLevel: () => LogLevel = () => "warn";

/** Wire the live settings getter. Idempotent — last caller wins.
 *  Called once from SettingsProvider. */
export function setLogLevelGetter(fn: () => LogLevel): void {
  getLevel = fn;
}

function emit(severity: LogLevel, fn: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    if (RANK[getLevel()] >= RANK[severity]) {
      fn(...args);
    }
  };
}

/** Gated console wrappers. Use these in app code instead of bare
 *  `console.log` so the log-level setting actually filters them. */
export const log = {
  error: emit("error", console.error.bind(console)),
  warn: emit("warn", console.warn.bind(console)),
  info: emit("info", console.info.bind(console)),
  debug: emit("debug", console.debug.bind(console)),
};
