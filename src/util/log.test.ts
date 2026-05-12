import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The log module captures `console.error.bind(console)` etc. at import
// time, so the spies need to be installed BEFORE the module is loaded.
// We re-import per-test (vi.resetModules + dynamic import) so each test
// observes a freshly-bound set of console wrappers tied to its spies.

type LogMod = typeof import("./log");

async function freshLogWith(spies: {
  info?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}): Promise<LogMod> {
  if (spies.info) vi.spyOn(console, "info").mockImplementation(spies.info as (...args: unknown[]) => void);
  if (spies.debug) vi.spyOn(console, "debug").mockImplementation(spies.debug as (...args: unknown[]) => void);
  if (spies.warn) vi.spyOn(console, "warn").mockImplementation(spies.warn as (...args: unknown[]) => void);
  if (spies.error) vi.spyOn(console, "error").mockImplementation(spies.error as (...args: unknown[]) => void);
  vi.resetModules();
  return await import("./log");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("log", () => {
  it("default level is warn — info / debug calls are suppressed", async () => {
    const info = vi.fn();
    const debug = vi.fn();
    const warn = vi.fn();
    const { log } = await freshLogWith({ info, debug, warn });

    log.info("hello");
    log.debug("hello");
    log.warn("hello");

    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("hello");
  });

  it("passes the message through unformatted (rule 10 — parameterized logging)", async () => {
    const debug = vi.fn();
    const { log, setLogLevelGetter } = await freshLogWith({ debug });
    setLogLevelGetter(() => "debug");
    log.debug("count", 7, { ok: true });
    expect(debug).toHaveBeenCalledWith("count", 7, { ok: true });
  });

  it("level=off silences every channel including error", async () => {
    const error = vi.fn();
    const warn = vi.fn();
    const { log, setLogLevelGetter } = await freshLogWith({ error, warn });
    setLogLevelGetter(() => "off");
    log.error("e");
    log.warn("w");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("level=info enables info but not debug", async () => {
    const info = vi.fn();
    const debug = vi.fn();
    const { log, setLogLevelGetter } = await freshLogWith({ info, debug });
    setLogLevelGetter(() => "info");
    log.info("i");
    log.debug("d");
    expect(info).toHaveBeenCalledWith("i");
    expect(debug).not.toHaveBeenCalled();
  });

  it("setLogLevelGetter is idempotent — last caller wins", async () => {
    const debug = vi.fn();
    const { log, setLogLevelGetter } = await freshLogWith({ debug });
    setLogLevelGetter(() => "warn");
    setLogLevelGetter(() => "debug");
    log.debug("now-on");
    expect(debug).toHaveBeenCalledWith("now-on");
  });

  it("error channel fires at level=error (symmetric to off-suppression)", async () => {
    const error = vi.fn();
    const { log, setLogLevelGetter } = await freshLogWith({ error });
    setLogLevelGetter(() => "error");
    log.error("boom");
    expect(error).toHaveBeenCalledWith("boom");
  });
});
