// BOOK-TZ-1 — per-lead timezone display helpers.
//
// The booked absolute time ALWAYS stays business-tz (GHL availability is queried in the
// business zone and book-appointments matches the model's HH:MM against those business-tz
// slots). These helpers only affect how offered times are DISPLAYED to the lead: when the
// lead has a valid, different timezone we render each slot's lead-zone equivalent as an
// annotation next to the business-zone time the model actually books.
//
// TWIN: byte-identical to trigger/_shared/leadTimezone.ts (edge fns + Trigger.dev can't
// share an import path — keep both in sync, like phone.ts).
//
// Only Intl.DateTimeFormat is available in the Deno edge runtime (no luxon/date-fns).

/** True if `tz` is a real IANA zone the runtime accepts. GHL sometimes stores junk labels. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedZone {
  zone: string;
  /** true only when the lead has a valid zone that DIFFERS from the business zone. */
  isLeadZone: boolean;
}

/**
 * Resolve the zone to DISPLAY offered slots in. Uses the lead's own zone only when it is
 * valid and different from the business zone; otherwise falls back to the business zone
 * (today's behaviour). Never affects what time is booked.
 */
export function resolveLeadDisplayTimeZone(
  leadTz: string | null | undefined,
  clientTz: string,
): ResolvedZone {
  if (isValidTimeZone(leadTz) && leadTz !== clientTz) {
    return { zone: leadTz as string, isLeadZone: true };
  }
  return { zone: clientTz, isLeadZone: false };
}

/** Short human label for a zone: "Australia/Perth" -> "Perth". Used in prompt copy. */
export function zoneShortLabel(tz: string): string {
  const seg = tz.split("/").pop() ?? tz;
  return seg.replace(/_/g, " ");
}

/**
 * Render the wall-clock time of an absolute instant IN a target zone.
 * `iso` is a GHL slot string carrying the business offset (e.g. 2026-07-10T14:00:00+10:00);
 * we re-interpret that instant in `zone`. Returns 24h "HH:MM" (matching the existing
 * compactSlots format) and a friendly 12h label ("12:00 pm"), or null if unparseable.
 */
export function formatSlotInZone(
  iso: string,
  zone: string,
): { hhmm: string; label: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    // Intl can emit "24" for midnight in hour12:false — normalise to "00".
    const hh = hour === "24" ? "00" : hour;
    const hhmm = `${hh}:${minute}`;
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d).toLowerCase();
    return { hhmm, label };
  } catch {
    return null;
  }
}
