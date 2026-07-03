// PROMPT-AUTH-1 — save-time lint for TEXT-setter prompts.
//
// The 2026-07-03 incident: a stale auto-seeded booking template inside the stored
// prompt hard-coded a fabricated "Available days: Tue/Wed/Thu ONLY" policy, a dead
// {{ $now }} token the native engine never interpolates, and ~18 legacy n8n tool
// names, and the setter booked the wrong day against a fully open calendar. This
// lint makes that class of content un-saveable (errors) or at least visible
// (warnings), with exact line numbers so the operator can fix it in the UI.
//
// TEXT channel only. Voice prompts legitimately contain {{...}} tokens (Retell
// interpolates them at call time) — never run this on the voice channel.
//
// Pure module: no Deno APIs, no I/O.

export type LintSeverity = "error" | "warning";

export type LintFinding = {
  rule: string;
  severity: LintSeverity;
  line: number; // 1-based
  excerpt: string;
  message: string;
};

export type LintResult = {
  ok: boolean; // false when any error-severity finding exists
  errors: LintFinding[];
  warnings: LintFinding[];
};

const LEGACY_TOOL_NAMES =
  /\b(Get_Available_Slot|bookAppointment|createContact|getContactAppointments1|updateAppointment1|cancelAppointment1)\b/i;

// Hard-coded weekday availability policies. Availability is DATA (the injected
// live calendar), never prose — any in-prompt day policy can silently override
// the real calendar, which is exactly the incident.
const DAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)days?";
// PROMPT-LINT-1: abbreviated stems (Mon/Tue/Wed/Thu/Fri/Sat/Sun) for the
// hyphenated-range pattern only — a bare "mon"/"tue" is too short to safely
// match as a standalone weekday-policy signal, but "Mon-Fri"/"Monday-Friday"
// as a hyphenated range is unambiguous.
const DAY_STEM = "(?:mon|tue|wed|thu|fri|sat|sun)\\w*";
const WEEKDAY_POLICY_PATTERNS: RegExp[] = [
  /available\s+days?\s*(?:\*\*)?\s*:/i,
  new RegExp(`\\b(?:only\\s+(?:book|available|schedule)|book\\s+only|bookings?\\s+only)\\b[^.\\n]*\\b${DAY}\\b`, "i"),
  new RegExp(`\\bwe\\s+(?:only\\s+)?(?:book|do|take)\\b[^.\\n]*\\b${DAY}\\s+only\\b`, "i"),
  new RegExp(`\\b${DAY}\\s+only\\b`, "i"),
  // PROMPT-LINT-1: hyphenated day ranges, abbreviated or full: "Mon-Fri", "Monday-Friday".
  new RegExp(`\\b${DAY_STEM}\\s*-\\s*${DAY_STEM}\\b`, "i"),
  // PROMPT-LINT-1: reworded restrictive phrasing: "don't/do not/never/no book(ings) on <day>".
  new RegExp(`\\b(?:don'?t|do\\s+not|never|no)\\s+(?:book|schedule|take\\s+bookings?)\\b[^.\\n]*\\b${DAY}\\b`, "i"),
  // PROMPT-LINT-1: day-list-first "only days" phrasing: "Tuesdays and Wednesdays are the only days...".
  new RegExp(`\\b${DAY}(?:\\s*(?:,|and)\\s*${DAY})*\\s+(?:are\\s+)?(?:the\\s+)?only\\s+days?\\b`, "i"),
];

// Canned example bookings ("Booked for this Thursday at 2pm") teach a weak model
// to echo that literal time instead of the fetched slots.
const EXAMPLE_BOOKING_TIME =
  /\b(?:this|next)\s+(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;

function heading(line: string): string | null {
  const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
  if (!m) return null;
  return m[2].replace(/[:*]+\s*$/, "").trim().toLowerCase();
}

export function lintTextSetterPrompt(text: string): LintResult {
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];
  const lines = (text ?? "").split("\n");

  const add = (severity: LintSeverity, rule: string, lineIdx: number, message: string) => {
    const finding: LintFinding = {
      rule,
      severity,
      line: lineIdx + 1,
      excerpt: lines[lineIdx].trim().slice(0, 160),
      message,
    };
    (severity === "error" ? errors : warnings).push(finding);
  };

  const headingLines = new Map<string, number[]>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/\{\{[^}]*\}\}/.test(line)) {
      add(
        "error",
        "unresolved-template-token",
        i,
        "The text engine never interpolates {{...}} tokens — the model sees this literally (the {{ $now }} class of bug). Remove it; real values (current time, availability, lead identity) are injected by the engine each turn.",
      );
    }

    if (LEGACY_TOOL_NAMES.test(line)) {
      add(
        "error",
        "legacy-tool-name",
        i,
        "Legacy n8n tool name. The real tools are get-available-slots, book-appointments, get-contact-appointments, update-appointment, cancel-appointments, schedule-callback — and tool guidance is code-owned, so remove tool instructions from the prompt entirely.",
      );
    }

    for (const pattern of WEEKDAY_POLICY_PATTERNS) {
      if (pattern.test(line)) {
        add(
          "error",
          "weekday-availability-policy",
          i,
          "Hard-coded day-of-week availability policy. The injected live calendar is the only availability truth; a prose day rule can override an open calendar and cause wrong bookings.",
        );
        break;
      }
    }

    if (/^# SERVICE FUNCTIONS - TEXT AGENT WORKFLOW/i.test(line)) {
      add(
        "error",
        "legacy-booking-template",
        i,
        "This is the retired legacy n8n booking template. Delete the whole block — booking mechanics are code-owned now.",
      );
    }

    if (EXAMPLE_BOOKING_TIME.test(line)) {
      add(
        "warning",
        "example-booking-time",
        i,
        "Literal example booking time. Weak models echo these instead of the real fetched slots — remove or generalize the example.",
      );
    }

    if (/\{value\}/.test(line)) {
      add(
        "warning",
        "unresolved-value-token",
        i,
        "Un-substituted {value} placeholder from the section builder leaked into the prompt.",
      );
    }

    if (/default to (EST|EDT|PST|PDT|CST|CDT|MST|MDT)\b/i.test(line)) {
      add(
        "warning",
        "hardcoded-timezone-default",
        i,
        "Hard-coded US timezone default. The engine injects the client's real timezone; remove this rule.",
      );
    }

    const h = heading(line);
    if (h) {
      const arr = headingLines.get(h) ?? [];
      arr.push(i + 1);
      headingLines.set(h, arr);
    }
  }

  for (const [h, lineNumbers] of headingLines) {
    if (lineNumbers.length > 1) {
      warnings.push({
        rule: "duplicate-heading",
        severity: "warning",
        line: lineNumbers[1],
        excerpt: h,
        message: `Heading "${h}" appears ${lineNumbers.length} times (lines ${lineNumbers.join(", ")}). Duplicated sections dilute and can contradict each other — keep one.`,
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
