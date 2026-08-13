// Unit tests for nudgeConfig (per-client cold-reply nudge config).
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/nudgeConfig.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  parseNudgeOffsets,
  resolveNudgeConfig,
  DEFAULT_NUDGE_OFFSETS_HOURS,
  DEFAULT_NUDGE_RECOVERY_WINDOW_HOURS,
  NUDGE_COUNT_HARD_CAP,
  MIN_NUDGE_INTERVAL_HOURS,
  MAX_NUDGE_INTERVAL_HOURS,
} from "./nudgeConfig.ts";

test("parseNudgeOffsets: non-array falls back to default", () => {
  assert.deepEqual(parseNudgeOffsets(null), [...DEFAULT_NUDGE_OFFSETS_HOURS]);
  assert.deepEqual(parseNudgeOffsets(undefined), [...DEFAULT_NUDGE_OFFSETS_HOURS]);
  assert.deepEqual(parseNudgeOffsets("[24,72]"), [...DEFAULT_NUDGE_OFFSETS_HOURS]);
  assert.deepEqual(parseNudgeOffsets(24), [...DEFAULT_NUDGE_OFFSETS_HOURS]);
});

test("parseNudgeOffsets: valid arrays pass through, rounded", () => {
  assert.deepEqual(parseNudgeOffsets([8, 8, 8]), [8, 8, 8]);
  assert.deepEqual(parseNudgeOffsets([24, 24, 24]), [24, 24, 24]);
  assert.deepEqual(parseNudgeOffsets([24, 72]), [24, 72]);
  assert.deepEqual(parseNudgeOffsets([23.6, 71.4]), [24, 71]);
});

test("parseNudgeOffsets: drops invalid entries, keeps the rest", () => {
  assert.deepEqual(parseNudgeOffsets([24, -5, 0, "x", null, 48]), [24, 48]);
  assert.deepEqual(parseNudgeOffsets([NaN, Infinity, 12]), [12]);
});

test("parseNudgeOffsets: numeric strings are coerced", () => {
  assert.deepEqual(parseNudgeOffsets(["8", "16"]), [8, 16]);
});

test("parseNudgeOffsets: empty-after-clean falls back to default", () => {
  assert.deepEqual(parseNudgeOffsets([]), [...DEFAULT_NUDGE_OFFSETS_HOURS]);
  assert.deepEqual(parseNudgeOffsets([-1, 0, "nope"]), [...DEFAULT_NUDGE_OFFSETS_HOURS]);
});

test("parseNudgeOffsets: clamps each gap to [MIN, MAX]", () => {
  // below the min hourly floor rounds up to MIN
  assert.deepEqual(parseNudgeOffsets([0.2]), [MIN_NUDGE_INTERVAL_HOURS]);
  // above the 30d ceiling clamps down to MAX
  assert.deepEqual(parseNudgeOffsets([99999]), [MAX_NUDGE_INTERVAL_HOURS]);
});

test("parseNudgeOffsets: caps the count at the hard cap", () => {
  const many = Array.from({ length: 25 }, () => 4);
  assert.equal(parseNudgeOffsets(many).length, NUDGE_COUNT_HARD_CAP);
});

test("resolveNudgeConfig: null/undefined client uses all defaults, enabled", () => {
  const cfg = resolveNudgeConfig(null);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.offsetsHours, [...DEFAULT_NUDGE_OFFSETS_HOURS]);
  assert.equal(cfg.recoveryWindowHours, DEFAULT_NUDGE_RECOVERY_WINDOW_HOURS);
});

test("resolveNudgeConfig: enabled defaults true unless explicitly false", () => {
  assert.equal(resolveNudgeConfig({}).enabled, true);
  assert.equal(resolveNudgeConfig({ nudge_enabled: true }).enabled, true);
  assert.equal(resolveNudgeConfig({ nudge_enabled: null }).enabled, true);
  assert.equal(resolveNudgeConfig({ nudge_enabled: false }).enabled, false);
});

test("resolveNudgeConfig: reads offsets and recovery window", () => {
  const cfg = resolveNudgeConfig({
    nudge_enabled: true,
    nudge_offsets_hours: [8, 16, 24],
    nudge_recovery_window_hours: 720,
  });
  assert.deepEqual(cfg.offsetsHours, [8, 16, 24]);
  assert.equal(cfg.recoveryWindowHours, 720);
});

test("resolveNudgeConfig: bad recovery window falls back to default", () => {
  assert.equal(
    resolveNudgeConfig({ nudge_recovery_window_hours: 0 }).recoveryWindowHours,
    DEFAULT_NUDGE_RECOVERY_WINDOW_HOURS,
  );
  assert.equal(
    resolveNudgeConfig({ nudge_recovery_window_hours: "abc" }).recoveryWindowHours,
    DEFAULT_NUDGE_RECOVERY_WINDOW_HOURS,
  );
});
