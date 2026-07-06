// F15(b) weekly client ROI report — pure assembly + white-label HTML render.
//
// Takes already-fetched metrics for one client-week and produces { payload, html }.
// The payload is the full JSON snapshot (persisted to weekly_reports); the html
// is the CLIENT-facing white-label email, rendered with ONLY the sections the
// agency toggled on. Pure (no DB/HTTP) so it is unit-testable and both the
// weeklyClientReport Trigger cron and the get-weekly-report edge fn can import it.
//
// All caller-supplied strings (client/brand name, objections, improvements) are
// HTML-escaped before rendering (the report is emailed HTML).

export interface WeeklyReportSections {
  calls: boolean;
  sms: boolean;
  funnel: boolean;
  usage: boolean;
  objections: boolean;
  improvements: boolean;
}

export interface WeeklyReportInput {
  clientName: string;
  brandName?: string;
  periodLabel: string;
  calls: { made: number; answered: number };
  sms: { conversations: number };
  funnel: {
    booked: number;
    held: number;
    no_show: number;
    cancelled: number;
    show_rate: number | null;
    no_show_rate: number | null;
  };
  billed: { minutes: number; texts: number; total_label: string | null } | null;
  objections: string[];
  whatWeImproved: string[];
  sections: WeeklyReportSections;
}

export interface WeeklyReportOutput {
  payload: WeeklyReportInput;
  html: string;
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const pct = (v: number | null): string => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

function statTile(label: string, value: string): string {
  return (
    `<td style="padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">` +
    `<div style="font-size:22px;font-weight:700;color:#111827;">${escapeHtml(value)}</div>` +
    `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(label)}</div>` +
    `</td>`
  );
}

export function assembleWeeklyReport(input: WeeklyReportInput): WeeklyReportOutput {
  const brand = input.brandName?.trim() || "Your AI setter";
  const { sections: sec, funnel, calls, sms, billed } = input;

  const blocks: string[] = [];

  if (sec.funnel) {
    blocks.push(
      `<h3 style="font-size:15px;color:#111827;margin:20px 0 8px;">Appointments</h3>` +
        `<table role="presentation" cellspacing="8" cellpadding="0" style="border-collapse:separate;"><tr>` +
        statTile("Booked", String(funnel.booked)) +
        statTile("Held", String(funnel.held)) +
        statTile("No-show", String(funnel.no_show)) +
        statTile("Show rate", pct(funnel.show_rate)) +
        `</tr></table>`,
    );
  }
  if (sec.calls) {
    blocks.push(
      `<h3 style="font-size:15px;color:#111827;margin:20px 0 8px;">Calls</h3>` +
        `<table role="presentation" cellspacing="8" cellpadding="0" style="border-collapse:separate;"><tr>` +
        statTile("Made", String(calls.made)) +
        statTile("Answered", String(calls.answered)) +
        `</tr></table>`,
    );
  }
  if (sec.sms) {
    blocks.push(
      `<h3 style="font-size:15px;color:#111827;margin:20px 0 8px;">Text conversations</h3>` +
        `<table role="presentation" cellspacing="8" cellpadding="0" style="border-collapse:separate;"><tr>` +
        statTile("Conversations", String(sms.conversations)) +
        `</tr></table>`,
    );
  }
  if (sec.usage && billed) {
    const usageTiles = [
      statTile("Voice minutes", String(billed.minutes)),
      statTile("Texts", String(billed.texts)),
    ];
    if (billed.total_label) usageTiles.push(statTile("Billed", billed.total_label));
    blocks.push(
      `<h3 style="font-size:15px;color:#111827;margin:20px 0 8px;">Usage</h3>` +
        `<table role="presentation" cellspacing="8" cellpadding="0" style="border-collapse:separate;"><tr>` +
        usageTiles.join("") +
        `</tr></table>`,
    );
  }
  if (sec.objections && input.objections.length > 0) {
    blocks.push(
      `<h3 style="font-size:15px;color:#111827;margin:20px 0 8px;">What leads asked about</h3>` +
        `<ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;">` +
        input.objections.map((o) => `<li>${escapeHtml(o)}</li>`).join("") +
        `</ul>`,
    );
  }
  if (sec.improvements && input.whatWeImproved.length > 0) {
    blocks.push(
      `<h3 style="font-size:15px;color:#111827;margin:20px 0 8px;">What we improved this week</h3>` +
        `<ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;">` +
        input.whatWeImproved.map((w) => `<li>${escapeHtml(w)}</li>`).join("") +
        `</ul>`,
    );
  }

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">` +
    `<div style="font-size:20px;font-weight:700;">${escapeHtml(brand)}</div>` +
    `<div style="font-size:13px;color:#6b7280;margin-top:2px;">Weekly report for ${escapeHtml(input.clientName)} &middot; ${escapeHtml(input.periodLabel)}</div>` +
    blocks.join("") +
    `<div style="margin-top:28px;font-size:11px;color:#9ca3af;">Generated automatically. Reply to this email with any questions.</div>` +
    `</div>`;

  return { payload: input, html };
}
