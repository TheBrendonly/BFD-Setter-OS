import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assembleWeeklyReport, escapeHtml, type WeeklyReportInput } from "./weeklyReport.ts";

// F15(b) weekly report assembly — pure render tests.

const baseInput = (over: Partial<WeeklyReportInput> = {}): WeeklyReportInput => ({
  clientName: "Acme Co",
  brandName: "Building Flow Digital",
  periodLabel: "30 Jun 2026 to 6 Jul 2026",
  calls: { made: 40, answered: 22 },
  sms: { conversations: 15 },
  funnel: { booked: 8, held: 5, no_show: 1, cancelled: 2, show_rate: 5 / 6, no_show_rate: 1 / 6 },
  billed: { minutes: 60, texts: 15, total_label: "$120.00" },
  objections: ["price", "timing"],
  whatWeImproved: ["Tightened the booking script"],
  sections: { calls: true, sms: true, funnel: true, usage: true, objections: true, improvements: true },
  ...over,
});

Deno.test("escapeHtml neutralises markup", () => {
  assertEquals(escapeHtml('<script>"x"&y</script>'), "&lt;script&gt;&quot;x&quot;&amp;y&lt;/script&gt;");
});

Deno.test("all sections render when toggled on", () => {
  const { html, payload } = assembleWeeklyReport(baseInput());
  assertStringIncludes(html, "Acme Co");
  assertStringIncludes(html, "Building Flow Digital");
  assertStringIncludes(html, "Appointments");
  assertStringIncludes(html, "Calls");
  assertStringIncludes(html, "Text conversations");
  assertStringIncludes(html, "Usage");
  assertStringIncludes(html, "What leads asked about");
  assertStringIncludes(html, "What we improved");
  assertStringIncludes(html, "83%"); // show rate 5/6
  assertEquals(payload.funnel.booked, 8);
});

Deno.test("toggled-off sections are omitted from the html", () => {
  const { html } = assembleWeeklyReport(
    baseInput({ sections: { calls: false, sms: false, funnel: true, usage: false, objections: false, improvements: false } }),
  );
  assertStringIncludes(html, "Appointments");
  assertEquals(html.includes("Calls</h3>") || html.includes(">Calls<"), false);
  assertEquals(html.includes("Usage</h3>"), false);
  assertEquals(html.includes("What we improved"), false);
});

Deno.test("caller strings are HTML-escaped in the output", () => {
  const { html } = assembleWeeklyReport(
    baseInput({ clientName: "<b>x</b>", objections: ["<img src=x onerror=1>"] }),
  );
  assertStringIncludes(html, "&lt;b&gt;x&lt;/b&gt;");
  assertStringIncludes(html, "&lt;img src=x onerror=1&gt;");
  assertEquals(html.includes("<img src=x"), false);
});

Deno.test("null show_rate renders n/a", () => {
  const { html } = assembleWeeklyReport(
    baseInput({ funnel: { booked: 3, held: 0, no_show: 0, cancelled: 0, show_rate: null, no_show_rate: null } }),
  );
  assertStringIncludes(html, "n/a");
});
