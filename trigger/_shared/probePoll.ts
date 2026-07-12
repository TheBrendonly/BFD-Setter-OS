// Synthetic-probe Step-3 helpers (Bug 6.7).
//
// The probe must wait for the cadence's SMS node to enqueue an outbound row,
// not assert the instant the execution goes `running`. Trigger.dev start
// latency (45-82s) means the row materialises after a delay, so poll on a
// deadline instead of a single query.

export function hasOutboundRow(rows: unknown): boolean {
  return Array.isArray(rows) && rows.some((r) => (r as { channel?: string })?.channel === "sms_outbound");
}

// SCHED-1(b) — a legitimately PARKED cadence enqueues no outbound row by design, so the
// probe must treat that as a pass/skip, not a failure. runEngagement writes one of these
// stage descriptions when it parks outside the send window:
//   "Outside quiet hours — resuming at <time>"  (quiet-hours gate)
//   "Outside sending hours — resuming at <time>" (AU business-hours gate)
// Match those (and the generic "resuming at") so a real send-failure still fails.
export function isParkedStage(stageDescription: string | null | undefined): boolean {
  const s = (stageDescription ?? "").toString();
  if (!s) return false;
  return /outside (quiet|sending) hours|resuming at/i.test(s);
}

export interface PollOptions {
  deadlineMs: number;
  sleepMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Repeatedly call fetchFn until predicate(value) is true or the deadline passes.
 * Checks once immediately (no upfront sleep), then sleeps between attempts.
 * Clock + sleep are injectable so timing is unit-testable without real waits.
 */
export async function pollUntil<T>(
  fetchFn: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: PollOptions,
): Promise<{ ok: boolean; value: T }> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const deadline = now() + opts.deadlineMs;

  let value = await fetchFn();
  if (predicate(value)) return { ok: true, value };

  while (now() < deadline) {
    await sleep(opts.sleepMs);
    value = await fetchFn();
    if (predicate(value)) return { ok: true, value };
  }
  return { ok: false, value };
}
