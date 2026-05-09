import { describe, expect, it } from "vitest";
import {
  computeEta,
  formatCompletionTime,
  formatEtaSeconds,
  pushSample,
  type EtaSample,
} from "./etaTracker";

describe("pushSample", () => {
  it("adds the first sample", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 1000, 0);
    expect(buf).toEqual([{ t: 1000, bytes: 0 }]);
  });

  it("drops samples older than the window", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 1000, 0);
    pushSample(buf, 2000, 100);
    pushSample(buf, 3000, 200);
    pushSample(buf, 8500, 800); // 8500 - 5000 = 3500, so 1000 + 2000 drop
    expect(buf.map((s) => s.t)).toEqual([3000, 8500]);
  });

  it("always keeps at least one sample (for steady-state rate calc)", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 1000, 0);
    pushSample(buf, 100_000, 1_000_000); // huge gap
    expect(buf.length).toBeGreaterThanOrEqual(1);
    expect(buf[buf.length - 1]).toEqual({ t: 100_000, bytes: 1_000_000 });
  });

  it("coalesces duplicate-time samples (taking the latest bytes)", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 1000, 100);
    pushSample(buf, 1000, 200);
    expect(buf).toEqual([{ t: 1000, bytes: 200 }]);
  });
});

describe("computeEta", () => {
  it("returns null while the window is priming (< 1s span)", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 1000, 0);
    pushSample(buf, 1500, 500);
    expect(computeEta(buf, 10_000)).toEqual({
      bytesPerSec: null,
      etaSeconds: null,
    });
  });

  it("computes rate over the window once primed", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 0, 0);
    pushSample(buf, 5000, 5_000_000); // 1 MB/s
    const r = computeEta(buf, 10_000_000);
    expect(r.bytesPerSec).toBeCloseTo(1_000_000, -2);
    expect(r.etaSeconds).toBeCloseTo(5, 1);
  });

  it("returns 0 etaSeconds when remaining bytes are <= 0", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 0, 0);
    pushSample(buf, 5000, 1_000_000);
    expect(computeEta(buf, 1_000_000).etaSeconds).toBe(0);
  });

  it("returns null etaSeconds when total is unknown", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 0, 0);
    pushSample(buf, 5000, 1_000_000);
    const r = computeEta(buf, null);
    expect(r.bytesPerSec).toBeGreaterThan(0);
    expect(r.etaSeconds).toBeNull();
  });

  it("handles a stalled stream (zero delta) gracefully", () => {
    const buf: EtaSample[] = [];
    pushSample(buf, 0, 1000);
    pushSample(buf, 5000, 1000);
    const r = computeEta(buf, 5000);
    expect(r.bytesPerSec).toBe(0);
    expect(r.etaSeconds).toBeNull();
  });
});

describe("formatEtaSeconds", () => {
  it("formats sub-minute durations", () => {
    expect(formatEtaSeconds(0.4)).toBe("<1s");
    expect(formatEtaSeconds(45)).toBe("45s");
  });

  it("formats minutes + remainder seconds", () => {
    expect(formatEtaSeconds(60)).toBe("1m");
    expect(formatEtaSeconds(125)).toBe("2m 5s");
  });

  it("formats hours + remainder minutes", () => {
    expect(formatEtaSeconds(3600)).toBe("1h");
    expect(formatEtaSeconds(3660)).toBe("1h 1m");
    expect(formatEtaSeconds(7200 + 600)).toBe("2h 10m");
  });

  it("returns dash for null/non-finite", () => {
    expect(formatEtaSeconds(null)).toBe("—");
    expect(formatEtaSeconds(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatCompletionTime", () => {
  it("renders an absolute clock time at now+eta", () => {
    // 9:00:00 + 90s = 9:01 → just confirm we get a non-dash string.
    const now = new Date("2026-05-08T09:00:00Z").getTime();
    const out = formatCompletionTime(90, now);
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns dash for null", () => {
    expect(formatCompletionTime(null)).toBe("—");
  });
});
