// Rolling-window ETA tracker for any byte-stream operation. Pure data
// structure — no React, no time mocking, no side effects. Take samples
// of `(timestamp, bytesDone)` over a 5-second window; ask the tracker
// for `(bytesPerSec, etaSeconds)` based on the current bytesTotal.
//
// Why 5 s and not "since the start"? A long sync that hits a fast
// kernel-copy phase early then a slow network phase later would give a
// hopelessly optimistic ETA from the cumulative average. The rolling
// window matches what every browser / file manager / installer shows
// and is what users expect.

export interface EtaSample {
  /** ms since epoch (or any monotonic clock the caller picks). */
  t: number;
  /** Cumulative bytes transferred at time `t`. */
  bytes: number;
}

export interface EtaTrackerOptions {
  /** Window size in ms. Default 5_000. */
  windowMs?: number;
  /** Don't return an ETA until the oldest sample is at least this old.
   *  Prevents a noisy first-tick estimate. Default 1_000. */
  primeMs?: number;
}

export interface EtaResult {
  /** Bytes-per-second over the window. `null` while priming. */
  bytesPerSec: number | null;
  /** Seconds remaining until `bytesTotal`. `null` when total is
   *  unknown, the window hasn't primed, or rate is 0. */
  etaSeconds: number | null;
}

/** Mutates the sample buffer in place: drops samples older than the
 *  window, then pushes the new one. Returns the same buffer for chaining. */
export function pushSample(
  buf: EtaSample[],
  t: number,
  bytes: number,
  windowMs = 5_000,
): EtaSample[] {
  const cutoff = t - windowMs;
  // Remove old samples (keep at least one for the rate computation —
  // we want the oldest-still-in-window so the window grows from one to
  // many samples cleanly).
  while (buf.length > 1 && buf[0].t < cutoff) {
    buf.shift();
  }
  // Skip duplicate-time pushes (some progress emitters fire twice with
  // the same timestamp; the math degenerates if we keep them).
  if (buf.length > 0 && buf[buf.length - 1].t === t) {
    buf[buf.length - 1].bytes = bytes;
  } else {
    buf.push({ t, bytes });
  }
  return buf;
}

/** Compute rate + ETA from a sample buffer. */
export function computeEta(
  buf: EtaSample[],
  bytesTotal: number | null | undefined,
  opts: EtaTrackerOptions = {},
): EtaResult {
  const primeMs = opts.primeMs ?? 1_000;
  if (buf.length < 2) return { bytesPerSec: null, etaSeconds: null };
  const first = buf[0];
  const last = buf[buf.length - 1];
  const dtMs = last.t - first.t;
  if (dtMs < primeMs) return { bytesPerSec: null, etaSeconds: null };
  const dBytes = last.bytes - first.bytes;
  if (dBytes <= 0) return { bytesPerSec: 0, etaSeconds: null };
  const bytesPerSec = (dBytes / dtMs) * 1000;
  if (bytesTotal == null || bytesTotal <= 0) {
    return { bytesPerSec, etaSeconds: null };
  }
  const remaining = bytesTotal - last.bytes;
  if (remaining <= 0) return { bytesPerSec, etaSeconds: 0 };
  return { bytesPerSec, etaSeconds: remaining / bytesPerSec };
}

/** Format a duration in seconds as "1h 23m" / "4m 12s" / "53s". */
export function formatEtaSeconds(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "—";
  if (secs < 1) return "<1s";
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Format the absolute completion time as a short locale string. */
export function formatCompletionTime(
  etaSeconds: number | null | undefined,
  now: number = Date.now(),
): string {
  if (etaSeconds == null || !Number.isFinite(etaSeconds)) return "—";
  const d = new Date(now + etaSeconds * 1000);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
