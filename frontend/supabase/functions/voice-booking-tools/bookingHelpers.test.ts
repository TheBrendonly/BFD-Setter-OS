// Unit tests for voice-booking-tools/bookingHelpers.ts (BOOK-2 / BOOK-3 / CANCEL-1).
//   deno test --no-check frontend/supabase/functions/voice-booking-tools/bookingHelpers.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  pickCanonicalSlot,
  hasExplicitOffset,
  wallClockLocalToEpochMs,
  extractApptEvents,
  realEventIds,
  activeAppointments,
} from "./bookingHelpers.ts";

const GRID = [
  "2026-07-02T14:00:00+10:00",
  "2026-07-02T14:30:00+10:00",
  "2026-07-02T16:00:00+10:00",
];

// ── BOOK-2 ──
Deno.test("pickCanonicalSlot: exact HH:MM match regardless of the model's offset", () => {
  assertEquals(pickCanonicalSlot(GRID, "14:00"), "2026-07-02T14:00:00+10:00");
  assertEquals(pickCanonicalSlot(GRID, "16:00"), "2026-07-02T16:00:00+10:00");
});

Deno.test("pickCanonicalSlot: snaps an off-by-a-minute near miss to the real slot (BOOK-2 fix)", () => {
  assertEquals(pickCanonicalSlot(GRID, "14:01"), "2026-07-02T14:00:00+10:00");
  assertEquals(pickCanonicalSlot(GRID, "13:59"), "2026-07-02T14:00:00+10:00");
  assertEquals(pickCanonicalSlot(GRID, "14:29"), "2026-07-02T14:30:00+10:00");
});

Deno.test("pickCanonicalSlot: a genuinely absent time (beyond tolerance) stays null", () => {
  assertEquals(pickCanonicalSlot(GRID, "15:00"), null); // nearest is 30 min away
  assertEquals(pickCanonicalSlot(GRID, "14:05"), null); // 5 min > 2 min tolerance
  assertEquals(pickCanonicalSlot([], "14:00"), null);
});

// ── BOOK-3 ──
Deno.test("hasExplicitOffset: detects Z / +HH:MM / -HHMM vs bare", () => {
  assertEquals(hasExplicitOffset("2026-07-08T00:00:00Z"), true);
  assertEquals(hasExplicitOffset("2026-07-08T00:00:00+10:00"), true);
  assertEquals(hasExplicitOffset("2026-07-08T00:00:00-0500"), true);
  assertEquals(hasExplicitOffset("2026-07-08T00:00:00"), false);
});

Deno.test("wallClockLocalToEpochMs: reads an offset-less wall clock in the client tz (BOOK-3 fix)", () => {
  // Sydney is UTC+10 on 2026-07-08 (no DST in July), so local midnight == 14:00 UTC the prior day.
  assertEquals(
    wallClockLocalToEpochMs("2026-07-08T00:00:00", "Australia/Sydney"),
    Date.parse("2026-07-08T00:00:00+10:00"),
  );
  // Space-separated form (GHL startTime shape) also parses.
  assertEquals(
    wallClockLocalToEpochMs("2026-07-08 09:30:00", "Australia/Sydney"),
    Date.parse("2026-07-08T09:30:00+10:00"),
  );
  // A UTC-zone client is a no-op relative to host UTC parsing.
  assertEquals(
    wallClockLocalToEpochMs("2026-07-08T00:00:00", "UTC"),
    Date.parse("2026-07-08T00:00:00Z"),
  );
  assertEquals(wallClockLocalToEpochMs("not-a-date", "Australia/Sydney"), null);
});

// ── CANCEL-1 ──
const APPTS_BODY = {
  events: [
    { id: "realA", startTime: "2026-07-08 14:00:00", title: "Strategy Call", appointmentStatus: "confirmed" },
    { id: "realB", startTime: "2026-07-02 11:30:00", title: "Older Call", appointmentStatus: "confirmed" },
    { id: "cancelledC", startTime: "2026-07-05 10:00:00", appointmentStatus: "cancelled" },
    { id: "deletedD", startTime: "2026-07-06 10:00:00", deleted: true },
    { notAnId: true },
  ],
  traceId: "xyz",
};

Deno.test("extractApptEvents: pulls real (non-deleted) events with ids", () => {
  const events = extractApptEvents(APPTS_BODY);
  assertEquals(events.map((e) => e.id), ["realA", "realB", "cancelledC"]);
});

Deno.test("extractApptEvents: tolerates junk shapes", () => {
  assertEquals(extractApptEvents(null), []);
  assertEquals(extractApptEvents({}), []);
  assertEquals(extractApptEvents({ events: "nope" }), []);
});

Deno.test("realEventIds: the binding set a cancel/reschedule eventId must be in", () => {
  const ids = realEventIds(extractApptEvents(APPTS_BODY));
  assertEquals(ids.has("realA"), true);
  assertEquals(ids.has("cancelledC"), true);
  assertEquals(ids.has("deletedD"), false);
  // The fabricated placeholder from the CANCEL-1 repro must NOT validate.
  assertEquals(ids.has("6470700000000000000000000000000000000000000000000000000000000000"), false);
});

Deno.test("activeAppointments: drops cancelled, sorts earliest first", () => {
  const view = activeAppointments(extractApptEvents(APPTS_BODY));
  assertEquals(view.map((e) => e.id), ["realB", "realA"]);
});
