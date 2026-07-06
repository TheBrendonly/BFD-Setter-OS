import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyBookingStatus,
  computeFunnel,
  computeFunnelByDimension,
  type FunnelBookingRow,
} from "./showRateFunnel.ts";

// F15(a) show-rate funnel — pure aggregation tests.

Deno.test("classifyBookingStatus maps the live vocabulary", () => {
  assertEquals(classifyBookingStatus("attended"), "held");
  assertEquals(classifyBookingStatus("no_show"), "no_show");
  assertEquals(classifyBookingStatus("cancelled"), "cancelled");
  assertEquals(classifyBookingStatus("confirmed"), "confirmed");
  assertEquals(classifyBookingStatus("new"), "confirmed"); // unknown-active
  assertEquals(classifyBookingStatus("NoShow"), "no_show"); // case-insensitive
});

Deno.test("computeFunnel counts stages + rates", () => {
  const rows: FunnelBookingRow[] = [
    { status: "attended", source: "voice_call" },
    { status: "attended", source: "sms_link" },
    { status: "attended", source: "voice_call" },
    { status: "no_show", source: "sms_link" },
    { status: "cancelled", source: "voice_call" },
    { status: "confirmed", source: "voice_call" }, // upcoming
  ];
  const f = computeFunnel(rows);
  assertEquals(f.booked, 6);
  assertEquals(f.held, 3);
  assertEquals(f.no_show, 1);
  assertEquals(f.cancelled, 1);
  assertEquals(f.upcoming, 1);
  assertEquals(f.confirmed, 5); // everything not cancelled
  // show rate = 3 / (3 + 1) = 0.75
  assertEquals(f.show_rate, 0.75);
  assertEquals(f.no_show_rate, 0.25);
});

Deno.test("computeFunnel: no appointments reached their time -> null rates", () => {
  const f = computeFunnel([
    { status: "confirmed", source: "voice_call" },
    { status: "cancelled", source: "sms_link" },
  ]);
  assertEquals(f.booked, 2);
  assertEquals(f.held, 0);
  assertEquals(f.no_show, 0);
  assertEquals(f.show_rate, null);
  assertEquals(f.no_show_rate, null);
});

Deno.test("computeFunnel: empty set is all zeros / null rates", () => {
  const f = computeFunnel([]);
  assertEquals(f.booked, 0);
  assertEquals(f.confirmed, 0);
  assertEquals(f.show_rate, null);
});

Deno.test("computeFunnelByDimension groups by source", () => {
  const rows: FunnelBookingRow[] = [
    { status: "attended", source: "voice_call" },
    { status: "no_show", source: "voice_call" },
    { status: "attended", source: "sms_link" },
    { status: "confirmed", source: null }, // -> "unknown"
  ];
  const bySource = computeFunnelByDimension(rows, (r) => r.source);
  assertEquals(bySource["voice_call"].booked, 2);
  assertEquals(bySource["voice_call"].show_rate, 0.5);
  assertEquals(bySource["sms_link"].held, 1);
  assertEquals(bySource["unknown"].upcoming, 1);
});
