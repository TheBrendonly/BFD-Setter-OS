import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertComplianceVerbatim,
  assessConversionCoverage,
  buildVoiceToTextMessages,
  detokenize,
  extractComplianceLines,
  finalizeTextPrompt,
  reassertComplianceLines,
  sanitizeComplianceLineForText,
  stripVoiceIsms,
  swapBookingSection,
} from "./transform.ts";
import { DEFAULT_TEXT_BOOKING_PROMPT, TEXT_CHANNEL_STYLE } from "./textBooking.ts";
import { lintTextSetterPrompt } from "../_shared/promptLint.ts";

// Voice -> text clone (2026-08-12 overnight build, spec item 2).
//
// The fixture is INLINED, not read from frontend/src/data/bfdVoiceSetterPrompt.md: the
// repo has no deno.json, so `deno test` runs with no permissions and cannot read files.
// It is hand-extracted from that prompt (lines 15, 27, 42, the VOICE RULES block, the
// AVAILABLE TOOLS block, the tool payload format block) plus one fabricated NCCP line,
// because BFD's own in-scope prompts carry no NCCP guardrail (only Voice-Setter-9,
// Stapleton, which is out of scope) and that branch would otherwise be untested.

const VOICE_FIXTURE = [
  "## WHO YOU ARE",
  "",
  "You are Gary, an AI assistant on Brendan Green's team at Building Flow Digital (BFD).",
  "",
  "You ARE an AI. You disclose this in your very first sentence on every call (ASIC misleading-conduct rule, Australia). If asked again later, you confirm it confidently and offer the caller a choice to escalate to Brendan directly.",
  "",
  "## OPENING THE CALL (FIRST SENTENCE: AI DISCLOSURE + RECORDING DISCLOSURE)",
  "",
  "Say this verbatim at the very start of every call:",
  "",
  '"Hey, this is Gary, I\'m Brendan\'s AI assistant at Building Flow Digital. Just so you know, this call is being recorded for quality. What can I help you with?"',
  "",
  "## VOICE RULES (HARD LIMITS)",
  "",
  "- **Response length:** maximum 1 to 2 sentences per turn. Phone call, not speech.",
  "- **Filler words:** use naturally. \"um\", \"uh\", \"you know\". Sprinkle, do not force.",
  "- **Verbal nods while they're speaking:** \"Mhmm\", \"Yeah\", \"Got it\".",
  "- **Interruption rule:** if the caller starts talking, stop immediately.",
  "- **Text slang BANNED on voice:** never say \"lol\", \"btw\", \"ngl\".",
  "",
  "## FOUNDER BACKSTORY (WHEN ASKED \"WHO'S BEHIND THIS?\")",
  "",
  "Brendan spent years in property before building BFD. He built Gary because every minute between an enquiry and first contact destroys conversion.",
  "",
  "## GUARDRAILS",
  "",
  "NCCP GUARDRAIL, never give credit assistance. On rates, products, borrowing capacity, or lender comparison say: \"That's exactly the kind of thing Brendan will walk you through properly when you speak.\"",
  "",
  "## LEAD CONTEXT",
  "",
  "- Lead name: {{first_name}} {{last_name}}",
  "- Lead email: {{email}}",
  "- Current time: {{current_time}}",
  "- Internal routing ref: {{unknown_routing_token}}",
  "",
  "Greet them by name: \"Hey {{first_name}}, it's Gary from Building Flow Digital.\"",
  "",
  "## AVAILABLE TOOLS",
  "",
  "Run tools one at a time. Always wait for the result before speaking or calling another.",
  "",
  "**get-available-slots**",
  'Body: `{ "timeZone": "<IANA>", "startDateTime": "<ISO>" }`',
  "Use for ALL availability checks.",
  'Speak: "One sec, let me check what\'s open for that date."',
  "",
  "**book-appointments**",
  'Body: `{ "phone": "<E.164>", "startDateTime": "<ISO>" }`',
  'Speak: "Yep, great, let me lock that in for you now."',
  "",
  "## BOOKING FLOW",
  "",
  "**Calendar:** 30 minute strategy call with Brendan.",
  "**Step 4, check availability:** call get-available-slots for every booking. Speak while it runs: \"One sec.\"",
  "",
  "## OBJECTION RESPONSES (1 to 2 sentences, AU register)",
  "",
  "If they say it's too expensive: acknowledge, then ask what they're comparing it to.",
].join("\n");

const AI_DISCLOSURE =
  "You ARE an AI. You disclose this in your very first sentence on every call (ASIC misleading-conduct rule, Australia). If asked again later, you confirm it confidently and offer the caller a choice to escalate to Brendan directly.";
const RECORDING_LINE =
  '"Hey, this is Gary, I\'m Brendan\'s AI assistant at Building Flow Digital. Just so you know, this call is being recorded for quality. What can I help you with?"';
const NCCP_LINE =
  'NCCP GUARDRAIL, never give credit assistance. On rates, products, borrowing capacity, or lender comparison say: "That\'s exactly the kind of thing Brendan will walk you through properly when you speak."';

const CONTROL_LINE =
  "Brendan spent years in property before building BFD. He built Gary because every minute between an enquiry and first contact destroys conversion.";

// ── extractComplianceLines ───────────────────────────────────────────────────

Deno.test("finds the AI disclosure line", () => {
  const found = extractComplianceLines(VOICE_FIXTURE);
  const ai = found.filter((c) => c.kind === "ai_disclosure").map((c) => c.text);
  assert(ai.includes(AI_DISCLOSURE), `got: ${JSON.stringify(ai)}`);
});

Deno.test("finds the recording-disclosure opening line", () => {
  const found = extractComplianceLines(VOICE_FIXTURE);
  const rec = found.filter((c) => c.kind === "recording").map((c) => c.text);
  assert(rec.includes(RECORDING_LINE), `got: ${JSON.stringify(rec)}`);
});

Deno.test("finds the NCCP credit-assistance guardrail", () => {
  const found = extractComplianceLines(VOICE_FIXTURE);
  const nccp = found.filter((c) => c.kind === "nccp").map((c) => c.text);
  assertEquals(nccp, [NCCP_LINE]);
});

Deno.test("a doc with no compliance markers returns [] and does not throw", () => {
  // This is the real state of BFD Voice-Setter-4 through 7 (demo personas).
  const bare = "## WHO YOU ARE\n\nYou are a friendly assistant.\n\n## GOAL\n\nBook a call.";
  assertEquals(extractComplianceLines(bare), []);
});

Deno.test("headings are never captured as compliance lines", () => {
  const found = extractComplianceLines(VOICE_FIXTURE);
  assertEquals(found.some((c) => c.text.startsWith("#")), false);
});

// ── detokenize ───────────────────────────────────────────────────────────────

Deno.test("a known token becomes a readable placeholder and its sentence survives", () => {
  const r = detokenize('Greet them: "Hey {{first_name}}, it\'s Gary."');
  assertEquals(r.text, 'Greet them: "Hey [first name], it\'s Gary."');
  assert(r.replaced.some((x) => x.startsWith("{{first_name}}")));
});

Deno.test("a line that is nothing but tokens and punctuation is dropped", () => {
  const r = detokenize("- {{first_name}} {{last_name}}\nkeep me");
  assertEquals(r.text, "keep me");
  assertEquals(r.droppedLines, ["- {{first_name}} {{last_name}}"]);
});

Deno.test("a LABELLED token line keeps its label: the label is the instruction", () => {
  const r = detokenize("- Lead name: {{first_name}} {{last_name}}");
  assertEquals(r.text, "- Lead name: [first name] [last name]");
  assertEquals(r.droppedLines, []);
});

Deno.test("an unknown token takes its whole line, recorded for the operator", () => {
  const r = detokenize("- Internal routing ref: {{unknown_routing_token}}\nkeep me");
  assertEquals(r.text, "keep me");
  assertEquals(r.droppedLines, ["- Internal routing ref: {{unknown_routing_token}}"]);
});

Deno.test("HARD GUARANTEE: no {{ }} survives detokenize", () => {
  const r = detokenize(VOICE_FIXTURE);
  assertEquals(/\{\{[^}]*\}\}/.test(r.text), false);
});

Deno.test("text without tokens is returned byte-identical", () => {
  const plain = "## GOAL\n\nBook a call. Never quote prices.";
  assertEquals(detokenize(plain).text, plain);
});

// ── stripVoiceIsms ───────────────────────────────────────────────────────────

Deno.test("removes Speak lines and Body call specs", () => {
  const r = stripVoiceIsms(VOICE_FIXTURE);
  assertEquals(/^\s*Speak\s*:/im.test(r.text), false);
  assertEquals(/^\s*Body\s*:/im.test(r.text), false);
  assertEquals(/Speak while it runs/i.test(r.text), false);
});

Deno.test("removes the voice-only turn-taking rules", () => {
  const r = stripVoiceIsms(VOICE_FIXTURE);
  for (const gone of ["Response length:", "Filler words:", "Verbal nods", "Interruption rule:", "Text slang BANNED"]) {
    assertEquals(r.text.includes(gone), false, `${gone} should be stripped`);
  }
  assert(r.removed.length >= 5, `removed: ${r.removed.length}`);
});

Deno.test("leaves non-voice content byte-identical", () => {
  const r = stripVoiceIsms(VOICE_FIXTURE);
  assert(r.text.includes(CONTROL_LINE));
  assert(r.text.includes(AI_DISCLOSURE));
  assert(r.text.includes(NCCP_LINE));
});

// ── swapBookingSection ───────────────────────────────────────────────────────

Deno.test("replaces the tools and booking-flow sections with the text booking block", () => {
  const r = swapBookingSection(VOICE_FIXTURE);
  assertEquals(r.text.includes("## AVAILABLE TOOLS"), false);
  assertEquals(r.text.includes("## BOOKING FLOW"), false);
  assert(r.text.includes("# BOOKING APPROACH"));
  assert(r.text.includes("# TEXT CHANNEL STYLE"));
  assert(r.removedSections.length >= 2, `removed: ${JSON.stringify(r.removedSections)}`);
});

Deno.test("a section ends at the next heading and cannot swallow the rest of the doc", () => {
  const r = swapBookingSection(VOICE_FIXTURE);
  // OBJECTION RESPONSES follows BOOKING FLOW and must survive.
  assert(r.text.includes("## OBJECTION RESPONSES"));
  assert(r.text.includes("If they say it's too expensive"));
});

Deno.test("appends the booking section when the source has none", () => {
  const r = swapBookingSection("## GOAL\n\nBook a call.");
  assert(r.text.includes("# BOOKING APPROACH"));
  assertEquals(r.removedSections, []);
});

// ── compliance verify + repair ───────────────────────────────────────────────

Deno.test("assertComplianceVerbatim flags a dropped disclosure", () => {
  const required = extractComplianceLines(VOICE_FIXTURE);
  const r = assertComplianceVerbatim("a prompt that forgot everything", required);
  assertEquals(r.ok, false);
  assertEquals(r.missing.length, required.length);
});

Deno.test("reassertComplianceLines puts each missing line back byte-identically", () => {
  const required = extractComplianceLines(VOICE_FIXTURE);
  const repaired = reassertComplianceLines("a prompt that forgot everything", required);
  for (const c of required) {
    assert(repaired.includes(c.text), `missing verbatim: ${c.text.slice(0, 60)}`);
  }
});

Deno.test("reassertComplianceLines is a no-op when nothing is missing", () => {
  assertEquals(reassertComplianceLines("unchanged", []), "unchanged");
});

Deno.test("one line matching two kinds is listed once, not twice", () => {
  // BFD's real opener is BOTH the AI disclosure and the recording disclosure, so
  // extract returns two entries with identical text.
  const dupe = [
    { kind: "ai_disclosure" as const, text: "- I'm an AI and this call may be recorded.", line: 1 },
    { kind: "recording" as const, text: "- I'm an AI and this call may be recorded.", line: 1 },
  ];
  const out = reassertComplianceLines("body", dupe);
  const occurrences = out.split("I'm an AI and this call may be recorded.").length - 1;
  assertEquals(occurrences, 1);
});

Deno.test("a source line that already had a bullet does not render as '- - '", () => {
  const out = reassertComplianceLines("body", [
    { kind: "recording" as const, text: "- this call may be recorded", line: 1 },
  ]);
  assertEquals(out.includes("- - "), false);
  assert(out.includes("- this call may be recorded"));
});

// ── finalizeTextPrompt ───────────────────────────────────────────────────────

const COMPLIANCE = extractComplianceLines(VOICE_FIXTURE);

Deno.test("end to end on the fixture: lint-clean, AI disclosure + NCCP intact, recording dropped", () => {
  const r = finalizeTextPrompt({ modelOutput: VOICE_FIXTURE, compliance: COMPLIANCE });
  assertEquals(r.lint.errors, []);
  assertEquals(r.ok, true);
  assert(r.prompt.includes(AI_DISCLOSURE));
  assert(r.prompt.includes(NCCP_LINE));
  // CLONE-COMPLIANCE-1: the voice recording disclosure is stripped for the text channel,
  // while the AI-disclosure clause of that same opener line is preserved.
  assert(!/recorded/i.test(r.prompt), "recording disclosure must not survive into text");
  assert(r.prompt.includes("I'm Brendan's AI assistant at Building Flow Digital"));
});

Deno.test("a model that dropped ALL compliance still yields (text-channel) compliance", () => {
  // The guarantee holds no matter what the model returned — but recording is dropped.
  const r = finalizeTextPrompt({
    modelOutput: "## WHO YOU ARE\n\nYou are Gary.\n\n## GOAL\n\nBook a call.",
    compliance: COMPLIANCE,
  });
  assertEquals(r.reasserted.length, COMPLIANCE.length);
  assert(r.prompt.includes(AI_DISCLOSURE));
  assert(r.prompt.includes(NCCP_LINE));
  assert(!/recorded/i.test(r.prompt), "recording disclosure must not be reasserted into text");
  assert(r.prompt.includes("I'm Brendan's AI assistant at Building Flow Digital"));
  assertEquals(r.ok, true);
});

Deno.test("no {{ }} token can reach the saved prompt", () => {
  const r = finalizeTextPrompt({ modelOutput: VOICE_FIXTURE, compliance: COMPLIANCE });
  assertEquals(/\{\{[^}]*\}\}/.test(r.prompt), false);
  assertEquals(r.lint.errors.some((e) => e.rule === "unresolved-template-token"), false);
});

Deno.test("no tool CALL SPEC survives, though the booking block names the tools", () => {
  // The spec's stated assertion ("no voice booking tool names in output") is not
  // achievable: DEFAULT_BOOKING_PROMPT itself names all six tools. The property that
  // actually matters is that no voice-side call spec or spoken filler survives.
  const r = finalizeTextPrompt({ modelOutput: VOICE_FIXTURE, compliance: COMPLIANCE });
  assertEquals(/^\s*Body\s*:/im.test(r.prompt), false);
  assertEquals(/Speak:/i.test(r.prompt), false);
  assertEquals(/startDateTime/.test(r.prompt), false);
  // ...and the sanctioned booking section IS present, tool names and all.
  assert(r.prompt.includes("get-available-slots"));
  assert(r.prompt.includes("# BOOKING APPROACH"));
});

Deno.test("a weekday policy invented by the model fails the gate, prompt still returned", () => {
  const r = finalizeTextPrompt({
    modelOutput: "## BOOKING\n\nAvailable days: Tuesday, Wednesday, Thursday ONLY.",
    compliance: [],
  });
  assertEquals(r.ok, false);
  assert(r.lint.errors.some((e) => e.rule === "weekday-availability-policy"));
  assert(r.prompt.length > 0, "the rejected draft must still be inspectable");
});

Deno.test("a legacy tool name from the model fails the gate", () => {
  const r = finalizeTextPrompt({
    modelOutput: "## BOOKING\n\nCall `bookAppointment` to confirm.",
    compliance: [],
  });
  assertEquals(r.ok, false);
  assert(r.lint.errors.some((e) => e.rule === "legacy-tool-name"));
});

Deno.test("SAVE PARITY: our gate and save-external-prompt's gate see the same string", () => {
  // save-external-prompt lints [persona, content].join(SAVE_SEPARATOR). We send an empty
  // persona, so the joined string is the content itself. If that ever stops holding, a
  // clone that passes here would 422 at the write.
  const SAVE_SEPARATOR = "\n\n── ── ── ── ── ── ── ── ── ── ── ── ── ──\n\n";
  const r = finalizeTextPrompt({ modelOutput: VOICE_FIXTURE, compliance: COMPLIANCE });
  const asSaved = ["", r.prompt].filter(Boolean).join(SAVE_SEPARATOR);
  assertEquals(asSaved, r.prompt);
  assertEquals(lintTextSetterPrompt(asSaved).ok, r.lint.ok);
});

Deno.test("the report tells the operator what was removed", () => {
  const r = finalizeTextPrompt({ modelOutput: VOICE_FIXTURE, compliance: COMPLIANCE });
  assert(r.removedVoiceIsms.length > 0);
  assert(r.removedSections.length > 0);
  assert(r.droppedTokenLines.length > 0);
  assert(r.replacedTokens.length > 0);
});

// ── coverage gate ────────────────────────────────────────────────────────────

Deno.test("coverage: a summarised conversion is rejected", () => {
  // Calibrated on the real 2026-08-12 failure: a 20,082-char voice doc came back as a
  // 1,439-char greeting that echoed the compliance block, and it linted perfectly clean.
  const c = assessConversionCoverage(20082, 1439);
  assertEquals(c.ok, false);
  assert(c.ratio < 0.1, `ratio was ${c.ratio}`);
});

Deno.test("coverage: a genuinely converted prompt passes even though text is shorter", () => {
  // Stripping tool specs and call flow legitimately loses length; the floor is generous.
  assertEquals(assessConversionCoverage(20000, 12000).ok, true);
  assertEquals(assessConversionCoverage(20000, 9000).ok, true);
  assertEquals(assessConversionCoverage(20000, 8000).ok, false);
});

Deno.test("coverage: an unknown source length skips the gate rather than guessing", () => {
  assertEquals(assessConversionCoverage(0, 500).ok, true);
});

Deno.test("finalizeTextPrompt fails on a gutted conversion even when lint is clean", () => {
  const gutted = "## WHO YOU ARE\n\nYou are Gary. Book a call.";
  const r = finalizeTextPrompt({ modelOutput: gutted, compliance: [], sourceChars: 20000 });
  assertEquals(r.lint.ok, true, "lint alone cannot catch this");
  assertEquals(r.coverage?.ok, false);
  assertEquals(r.ok, false, "the combined gate must reject it");
});

Deno.test("finalizeTextPrompt measures the MODEL's output, not our appended blocks", () => {
  // The booking + style blocks we append are ~1.5k chars and must not pad a gutted
  // conversion over the line.
  const r = finalizeTextPrompt({ modelOutput: "tiny", compliance: [], sourceChars: 3000 });
  assertEquals(r.coverage?.outputChars, 4);
  assert(r.prompt.length > 1000, "the finished file is padded by our blocks");
  assertEquals(r.ok, false);
});

Deno.test("omitting sourceChars leaves coverage null and the gate off", () => {
  const r = finalizeTextPrompt({ modelOutput: VOICE_FIXTURE, compliance: COMPLIANCE });
  assertEquals(r.coverage, null);
  assertEquals(r.ok, true);
});

// ── the booking twin ─────────────────────────────────────────────────────────

Deno.test("the DEFAULT_TEXT_BOOKING_PROMPT twin is lint-clean", () => {
  // Guards the twin against drifting from frontend/src/data/defaultBookingPrompt.ts
  // into something save-external-prompt would reject.
  assertEquals(lintTextSetterPrompt(DEFAULT_TEXT_BOOKING_PROMPT).ok, true);
  assertEquals(lintTextSetterPrompt(TEXT_CHANNEL_STYLE).ok, true);
});

// ── buildVoiceToTextMessages ─────────────────────────────────────────────────

Deno.test("the system message carries the compliance lines as must-preserve", () => {
  const msgs = buildVoiceToTextMessages({
    voiceDoc: VOICE_FIXTURE,
    compliance: COMPLIANCE,
    sourceSlotId: "Voice-Setter-10",
    targetSlotId: "Setter-2",
  });
  assertEquals(msgs.length, 2);
  assertEquals(msgs[0].role, "system");
  assert(msgs[0].content.includes(AI_DISCLOSURE));
  assert(/word for word/i.test(msgs[0].content));
});

Deno.test("the full doc is passed through whole, with no truncation", () => {
  const big = `${VOICE_FIXTURE}\n${"x".repeat(25000)}`;
  const msgs = buildVoiceToTextMessages({
    voiceDoc: big,
    compliance: COMPLIANCE,
    sourceSlotId: "Voice-Setter-10",
    targetSlotId: "Setter-2",
  });
  assert(msgs[1].content.includes(big), "the voice doc must not be truncated");
  assert(msgs[1].content.includes("Voice-Setter-10"));
  assert(msgs[1].content.includes("Setter-2"));
});

Deno.test("operator guidance rides along when supplied", () => {
  const msgs = buildVoiceToTextMessages({
    voiceDoc: "x",
    compliance: [],
    sourceSlotId: "Voice-Setter-10",
    targetSlotId: "Setter-2",
    userGuidelines: "keep it blunter",
  });
  assert(msgs[1].content.includes("keep it blunter"));
  assert(msgs[0].content.includes("(none detected in the source)"));
});

// ── CLONE-COMPLIANCE-1: voice-only compliance copy must not survive into a text prompt ──

const VOICE_OPENER =
  "Quick bit of honesty before we dive in, I'm Brendan's AI assistant helping with these calls, and the call may be recorded for quality. All good with you? [brief pause for acknowledgment or objection]";

Deno.test("sanitize: combined opener keeps the AI disclosure, drops recording + spoken pause", () => {
  const out = sanitizeComplianceLineForText(VOICE_OPENER);
  assert(out !== null);
  assert(/ai assistant/i.test(out!), "AI disclosure must be preserved");
  assert(!/record/i.test(out!), "recording clause must be stripped");
  assert(!out!.includes("["), "spoken-pause stage direction must be stripped");
  assert(!/\bpause\b/i.test(out!));
});

Deno.test("sanitize: a pure recording disclosure line drops out entirely (null)", () => {
  assertEquals(sanitizeComplianceLineForText("This call may be recorded for quality assurance."), null);
});

Deno.test("sanitize: an NCCP line is left untouched (obligation applies to text)", () => {
  const nccp = "As an AI I can give general info under our NCCP credit assistance licence, not personal advice.";
  const out = sanitizeComplianceLineForText(nccp);
  assertEquals(out, nccp);
});

Deno.test("sanitize: a spoken-pause direction is stripped but the AI disclosure stays", () => {
  const out = sanitizeComplianceLineForText("I'm an AI assistant. [pause for acknowledgment]");
  assert(out !== null);
  assert(!out!.includes("["));
  assert(/ai assistant/i.test(out!));
});

Deno.test("finalize: a reworded draft gets a text-clean reasserted compliance block (no recording/pause)", () => {
  const compliance = extractComplianceLines(VOICE_OPENER);
  assert(compliance.some((c) => c.kind === "recording"), "fixture must carry a recording obligation");
  const modelOutput = "Hey! Quick note before we start: I'm Brendan's AI assistant. How can I help today?";
  const r = finalizeTextPrompt({ modelOutput, compliance });
  assert(!/record/i.test(r.prompt), "reasserted block must not carry the recording disclosure");
  assert(!r.prompt.includes("[brief pause"), "reasserted block must not carry a spoken pause");
  assert(/ai assistant/i.test(r.prompt), "AI disclosure must still be present");
});

Deno.test("finalize: voice compliance copy the model preserved verbatim is scrubbed in place", () => {
  const compliance = extractComplianceLines(VOICE_OPENER);
  const modelOutput = `${VOICE_OPENER}\n\nSo, what are you after today?`;
  const r = finalizeTextPrompt({ modelOutput, compliance });
  assert(!/record/i.test(r.prompt), "the preserved voice recording clause must be scrubbed");
  assert(!r.prompt.includes("[brief pause"), "the preserved spoken pause must be scrubbed");
  assert(/ai assistant/i.test(r.prompt), "AI disclosure must survive the scrub");
});
