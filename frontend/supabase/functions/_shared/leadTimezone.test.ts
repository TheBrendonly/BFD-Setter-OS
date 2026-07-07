import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatSlotInZone,
  isValidTimeZone,
  resolveLeadDisplayTimeZone,
  zoneShortLabel,
} from "./leadTimezone.ts";

// BOOK-TZ-1 display helpers. The booked instant is unaffected; these only convert an
// absolute instant to a target zone for what the setter SAYS to the lead.

Deno.test("isValidTimeZone: accepts real zones, rejects junk", () => {
  assertEquals(isValidTimeZone("Australia/Perth"), true);
  assertEquals(isValidTimeZone("Australia/Sydney"), true);
  assertEquals(isValidTimeZone("Not/AZone"), false);
  assertEquals(isValidTimeZone(""), false);
  assertEquals(isValidTimeZone(null), false);
  assertEquals(isValidTimeZone("AEST"), false); // GHL sometimes stores non-IANA labels
});

Deno.test("resolveLeadDisplayTimeZone: lead zone wins only when valid AND different", () => {
  assertEquals(
    resolveLeadDisplayTimeZone("Australia/Perth", "Australia/Sydney"),
    { zone: "Australia/Perth", isLeadZone: true },
  );
  // same zone -> business zone, not flagged as lead zone
  assertEquals(
    resolveLeadDisplayTimeZone("Australia/Sydney", "Australia/Sydney"),
    { zone: "Australia/Sydney", isLeadZone: false },
  );
  // null lead tz -> business zone
  assertEquals(
    resolveLeadDisplayTimeZone(null, "Australia/Sydney"),
    { zone: "Australia/Sydney", isLeadZone: false },
  );
  // invalid lead tz -> business zone (defensive)
  assertEquals(
    resolveLeadDisplayTimeZone("Mars/Base", "Australia/Sydney"),
    { zone: "Australia/Sydney", isLeadZone: false },
  );
});

Deno.test("zoneShortLabel: last path segment, underscores to spaces", () => {
  assertEquals(zoneShortLabel("Australia/Perth"), "Perth");
  assertEquals(zoneShortLabel("America/New_York"), "New York");
  assertEquals(zoneShortLabel("UTC"), "UTC");
});

Deno.test("formatSlotInZone: Sydney slot rendered in Perth is 2h earlier", () => {
  // 2pm Sydney (AEST +10:00, no DST in July) -> 12pm Perth (AWST +08:00)
  const r = formatSlotInZone("2026-07-10T14:00:00+10:00", "Australia/Perth");
  assertEquals(r?.hhmm, "12:00");
  assertEquals(r?.label, "12:00 pm");
});

Deno.test("formatSlotInZone: same-zone render is unchanged", () => {
  const r = formatSlotInZone("2026-07-10T14:00:00+10:00", "Australia/Sydney");
  assertEquals(r?.hhmm, "14:00");
  assertEquals(r?.label, "2:00 pm");
});

Deno.test("formatSlotInZone: DST-aware (Jan, Sydney observes AEDT +11)", () => {
  // 2pm Sydney AEDT (+11:00 in January) -> 11am Perth (+08:00, no DST)
  const r = formatSlotInZone("2026-01-15T14:00:00+11:00", "Australia/Perth");
  assertEquals(r?.hhmm, "11:00");
});

Deno.test("formatSlotInZone: unparseable input -> null", () => {
  assertEquals(formatSlotInZone("not-a-date", "Australia/Perth"), null);
});
