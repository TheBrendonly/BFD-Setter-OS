// retention — per-client consent/retention cutoff logic.
//
// A lead may only be contacted while its consent is current. After the client's
// retention window (default 3 months) elapses from the lead's consent (or, if no
// explicit consent timestamp, its created_at), the lead must stop being
// contacted and drop out of any active cadence. This module isolates the pure
// "is this lead past its retention window" decision so the daily sweep
// (retentionCutoff) can be unit-tested without a DB.
//
// v1 = stop contacting + unenroll (setter_stopped + retention_expired flags).
// Actual PII anonymisation/deletion after a grace period is a later step.

export const DEFAULT_RETENTION_MONTHS = 3;

export interface ClientRetentionFields {
  retention_months?: unknown;
}

// Effective retention window in whole months. Missing / non-positive / malformed
// falls back to the default so a misconfigured client still gets a sane window.
export function resolveRetentionMonths(client: ClientRetentionFields | null | undefined): number {
  const n = typeof client?.retention_months === "number"
    ? client.retention_months
    : Number(client?.retention_months);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RETENTION_MONTHS;
  return Math.round(n);
}

// The instant a lead's consent expires: anchor + retentionMonths calendar
// months. UTC month arithmetic (setUTCMonth), so it never drifts across a
// local DST boundary the way setMonth would.
export function retentionCutoffDate(anchor: Date, retentionMonths: number): Date {
  const d = new Date(anchor.getTime());
  d.setUTCMonth(d.getUTCMonth() + retentionMonths);
  return d;
}

// True when `now` is past the retention window measured from `anchorIso`
// (the lead's consent_timestamp, or created_at when consent is absent). A
// missing / unparseable anchor returns false (cannot determine -> never expire).
export function isPastRetention(
  anchorIso: string | null | undefined,
  retentionMonths: number,
  now: Date,
): boolean {
  if (!anchorIso) return false;
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return false;
  return now.getTime() > retentionCutoffDate(anchor, retentionMonths).getTime();
}
