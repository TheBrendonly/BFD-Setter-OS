// nudgeConfig — per-client cold-reply nudge config.
//
// The cold-reply nudge timing/count used to be hardcoded constants in
// nudgeColdReply.ts (TIER_THRESHOLDS_HOURS = [24, 72, 168], nudge_count < 3),
// so changing "how many nudges, how far apart" meant a code edit + redeploy.
// It now lives on the clients row (nudge_enabled / nudge_offsets_hours /
// nudge_recovery_window_hours) so the agency can tune it per client from the
// UI. This module is the single source of truth for reading + validating that
// config, shared by the trigger task and its tests.

// Default preserves the prior backend behaviour (2 SMS nudges at +24h then
// +72h) for any client that has never touched the setting.
export const DEFAULT_NUDGE_OFFSETS_HOURS: readonly number[] = [24, 72];
export const DEFAULT_NUDGE_RECOVERY_WINDOW_HOURS = 24 * 14; // 336h — skip leads >14d cold
export const NUDGE_COUNT_HARD_CAP = 10; // safety ceiling on number of nudges
export const MIN_NUDGE_INTERVAL_HOURS = 1; // never nudge more than hourly (spam / legal)
export const MAX_NUDGE_INTERVAL_HOURS = 24 * 30; // 30d ceiling per gap

export interface NudgeConfig {
  enabled: boolean;
  // Gap in hours (since the previous outbound message) before each nudge is
  // sent. offsetsHours[i] is the wait before nudge (i+1). Because
  // last_outbound_at is re-stamped on every send, each entry is the spacing
  // from the previous message, not a cumulative offset from the first. The
  // array length is the number of SMS nudges sent before the lead is tagged
  // silent and given up on.
  offsetsHours: number[];
  recoveryWindowHours: number;
}

export interface ClientNudgeFields {
  nudge_enabled?: unknown;
  nudge_offsets_hours?: unknown;
  nudge_recovery_window_hours?: unknown;
}

// Validate a raw jsonb offsets value into a clean number[]. Drops non-finite /
// non-positive entries, rounds to whole hours, clamps each gap to
// [MIN, MAX]_NUDGE_INTERVAL_HOURS, caps the count at NUDGE_COUNT_HARD_CAP, and
// falls back to the default if nothing usable remains (an empty array would
// otherwise mean "give up immediately").
export function parseNudgeOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_NUDGE_OFFSETS_HOURS];
  const cleaned = raw
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) =>
      Math.min(Math.max(Math.round(n), MIN_NUDGE_INTERVAL_HOURS), MAX_NUDGE_INTERVAL_HOURS),
    )
    .slice(0, NUDGE_COUNT_HARD_CAP);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_NUDGE_OFFSETS_HOURS];
}

function parseRecoveryWindow(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_NUDGE_RECOVERY_WINDOW_HOURS;
  return Math.round(n);
}

// Resolve the effective nudge config for a client row (or a partial select of
// it). Missing / malformed values fall back to the defaults; `enabled` is true
// unless explicitly set false, so a client that predates the columns keeps
// nudging.
export function resolveNudgeConfig(client: ClientNudgeFields | null | undefined): NudgeConfig {
  return {
    enabled: client?.nudge_enabled !== false,
    offsetsHours: parseNudgeOffsets(client?.nudge_offsets_hours),
    recoveryWindowHours: parseRecoveryWindow(client?.nudge_recovery_window_hours),
  };
}
