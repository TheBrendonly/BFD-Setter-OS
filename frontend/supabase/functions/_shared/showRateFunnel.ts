// F15(a) show-rate funnel — pure aggregation (no DB, no HTTP).
//
// Turns a set of setter-created `bookings` rows into the booked -> confirmed ->
// held -> no-show funnel plus the show / no-show rates. The live bookings.status
// vocabulary is confirmed | attended | no_show | cancelled (bookings-webhook +
// voice-booking-tools). "held" == attended; an appointment that is still just
// "confirmed" is upcoming (not yet held/no-showed/cancelled).
//
// Only setter-created bookings reach here (Decision 4). Kept pure so the
// get-show-rate-funnel edge fn stays thin and this is unit-testable.

export interface FunnelBookingRow {
  status: string;              // confirmed | attended | no_show | cancelled | ...
  source: string | null;       // voice_call | sms_link | manual | ghl_calendar | intake_form
  lead_source?: string | null; // from the leads join (source_type / utm_source / form_source)
}

export interface FunnelCounts {
  booked: number;      // total appointments made
  confirmed: number;   // confirmed-or-beyond (everything not cancelled): held + no_show + upcoming
  held: number;        // attended / showed
  no_show: number;
  cancelled: number;
  upcoming: number;    // status confirmed, not yet held / no-showed / cancelled
  show_rate: number | null;    // held / (held + no_show); null until an appointment reaches its time
  no_show_rate: number | null; // no_show / (held + no_show)
}

const HELD = new Set(["attended", "showed", "completed", "held"]);
const NOSHOW = new Set(["no_show", "noshow", "no-show"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

type Stage = "held" | "no_show" | "cancelled" | "confirmed";

export function classifyBookingStatus(status: string): Stage {
  const s = (status || "").toLowerCase().trim();
  if (HELD.has(s)) return "held";
  if (NOSHOW.has(s)) return "no_show";
  if (CANCELLED.has(s)) return "cancelled";
  return "confirmed"; // confirmed / booked / new / anything else = an active upcoming booking
}

export function computeFunnel(rows: FunnelBookingRow[]): FunnelCounts {
  let held = 0, no_show = 0, cancelled = 0, upcoming = 0;
  for (const r of rows) {
    switch (classifyBookingStatus(r.status)) {
      case "held": held++; break;
      case "no_show": no_show++; break;
      case "cancelled": cancelled++; break;
      default: upcoming++; break;
    }
  }
  const booked = rows.length;
  const confirmed = held + no_show + upcoming; // everything not cancelled
  const reached = held + no_show;
  return {
    booked,
    confirmed,
    held,
    no_show,
    cancelled,
    upcoming,
    show_rate: reached > 0 ? held / reached : null,
    no_show_rate: reached > 0 ? no_show / reached : null,
  };
}

// F25 — held/no-show measured over appointments whose SCHEDULED time
// (`appointment_time`) falls in the reporting period, NOT the booking-creation date.
// At first-client (low) volume, a booking created near period-end but scheduled next
// period would otherwise swing the weekly show-rate. `booked` stays a creation cohort
// (labelled `held_window: "appointment_date"` by the caller); only the held/no-show
// slice + show/no-show rates are recomputed from the event-windowed rows and folded
// onto the creation-cohort funnel. Pass the SAME setter-source-filtered rows in.
export function withEventWindowedShowRate(
  creationFunnel: FunnelCounts,
  eventRows: FunnelBookingRow[],
): FunnelCounts {
  let held = 0, no_show = 0;
  for (const r of eventRows) {
    const stage = classifyBookingStatus(r.status);
    if (stage === "held") held++;
    else if (stage === "no_show") no_show++;
  }
  const reached = held + no_show;
  return {
    ...creationFunnel,
    held,
    no_show,
    show_rate: reached > 0 ? held / reached : null,
    no_show_rate: reached > 0 ? no_show / reached : null,
  };
}

// Break the funnel down by a dimension key (booking source or lead source).
export function computeFunnelByDimension(
  rows: FunnelBookingRow[],
  dim: (r: FunnelBookingRow) => string | null | undefined,
): Record<string, FunnelCounts> {
  const groups: Record<string, FunnelBookingRow[]> = {};
  for (const r of rows) {
    const key = (dim(r) || "unknown").toString();
    (groups[key] ??= []).push(r);
  }
  const out: Record<string, FunnelCounts> = {};
  for (const key of Object.keys(groups)) out[key] = computeFunnel(groups[key]);
  return out;
}
