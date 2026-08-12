// Voice prompt -> text setter prompt (2026-08-12 overnight build, spec item 2).
//
// WHY THIS EXISTS: ratified workflow step 6 clones a perfected VOICE agent across to the
// text setter. The existing cross-channel copy (copy-setter-config) reads only
// prompt_configurations and never touches prompt_docs, so since the doc model landed
// (2026-06-12) it has been re-personalising stale setup-time parameters while the live
// prompt, disclosures included, never entered the transform at all. On the BFD tenant
// prompt_configurations.__full_prompt__ is NULL on every slot, so there is not even a
// stale compiled prompt to fall back on.
//
// THE LOAD-BEARING IDEA: do not trust the model to preserve compliance or to remove
// template tokens. Verify and repair deterministically AFTER it runs.
//
//   - detokenize() runs on the model's output, so `unresolved-template-token` (a hard
//     lint error, and every BFD voice doc contains {{ }}) is structurally impossible
//     rather than probabilistically avoided.
//   - assertComplianceVerbatim() + reassertComplianceLines() make "the AI disclosure
//     survived" a property of the code, not of the prompt we sent.
//
// Pure module: no Deno APIs, no I/O, no network. Everything is testable.

import { lintTextSetterPrompt, type LintResult } from "../_shared/promptLint.ts";
import { DEFAULT_TEXT_BOOKING_PROMPT, TEXT_CHANNEL_STYLE } from "./textBooking.ts";

export type ComplianceKind = "ai_disclosure" | "recording" | "nccp";

export interface ComplianceLine {
  kind: ComplianceKind;
  /** The source line, verbatim. */
  text: string;
  /** 1-based line number in the source doc. */
  line: number;
}

/**
 * Markers for the three compliance families that must survive a channel change.
 *
 * These are AU legal boundaries, not style: ASIC misleading-conduct disclosure, the
 * recording disclosure, and the NCCP credit-assistance guardrail. Nothing in the repo
 * validated them before this module (promptLint has no compliance rule at all).
 */
const COMPLIANCE_PATTERNS: ReadonlyArray<{ kind: ComplianceKind; pattern: RegExp }> = [
  { kind: "ai_disclosure", pattern: /\b(you are an ai|i'?m an ai|is an ai|ai assistant|artificial intelligence)\b/i },
  { kind: "recording", pattern: /\brecord(ed|ing)\b/i },
  { kind: "nccp", pattern: /\b(nccp|credit assistance|credit licence|credit license)\b/i },
];

/** Headings whose whole section is voice-only plumbing and gets replaced wholesale. */
const VOICE_SECTION_HEADINGS =
  /^(#{1,3})\s*\**\s*(available tools|tools\b|tool payload|booking flow|flows?\b|dynamic variables)/i;

/**
 * Line-level voice-isms. Each entry is a documented reason, so a future reader can tell
 * an intentional removal from an over-eager regex.
 */
const VOICE_ISM_PATTERNS: ReadonlyArray<{ why: string; pattern: RegExp }> = [
  { why: "tool filler line spoken while a call waits", pattern: /^\s*[-*]?\s*\**\s*speak(\s+while[^:]*)?\s*\**\s*:/i },
  { why: "tool call body spec", pattern: /^\s*[-*]?\s*\**\s*body\s*\**\s*:/i },
  { why: "voice turn-length rule, replaced by the text style block", pattern: /^\s*[-*]\s*\**\s*response length\s*\**\s*:/i },
  { why: "spoken filler words", pattern: /^\s*[-*]\s*\**\s*filler words?\s*\**\s*:/i },
  { why: "spoken backchannel", pattern: /^\s*[-*]\s*\**\s*(verbal nods?|backchannel)[^:]*\s*\**\s*:/i },
  { why: "audio interruption handling", pattern: /^\s*[-*]\s*\**\s*interruption rule\s*\**\s*:/i },
  { why: "voice-only slang ban, meaningless on text", pattern: /^\s*[-*]\s*\**\s*text slang[^:]*\s*\**\s*:/i },
  { why: "speech pacing direction", pattern: /^\s*[-*]?\s*\**\s*(pace|pacing|tone of voice|speech rate)\s*\**\s*:/i },
  { why: "generic backchannel mention", pattern: /\bbackchannel\b/i },
];

/**
 * Template tokens the voice channel resolves at call time. Text has no equivalent
 * substitution, and any surviving {{ }} is a hard lint error, so known tokens become a
 * readable bracket placeholder and unknown ones take their whole line with them.
 */
const TOKEN_PHRASES: Readonly<Record<string, string>> = {
  first_name: "[first name]",
  last_name: "[last name]",
  email: "[email]",
  phone: "[phone]",
  business_name: "[business name]",
  user_contact_details: "[contact details]",
  custom_instructions: "[custom instructions]",
  current_time: "[the current date and time, injected each turn]",
  available_time_slots: "[the live calendar availability, injected each turn]",
  // Both engines carry conversation history, so these stay meaningful on text.
  // The set here is the full token vocabulary in use across the live BFD voice docs
  // as of 2026-08-12; anything outside it takes its line, by design.
  chat_history: "[the message history with this lead]",
  call_history: "[this lead's prior call history]",
};

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Find the compliance lines in a voice doc. An empty result is valid, not an error. */
export function extractComplianceLines(doc: string): ComplianceLine[] {
  const found: ComplianceLine[] = [];
  const seen = new Set<string>();
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    for (const { kind, pattern } of COMPLIANCE_PATTERNS) {
      if (!pattern.test(trimmed)) continue;
      const key = `${kind}:${trimmed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ kind, text: trimmed, line: i + 1 });
    }
  }
  return found;
}

export interface DetokenizeResult {
  text: string;
  /** Lines removed entirely because their tokens could not be resolved. */
  droppedLines: string[];
  /** `{{token}}` -> replacement, for the operator-facing report. */
  replaced: string[];
}

/**
 * Remove every `{{token}}`. Guarantees the output matches no `{{...}}`, which is what
 * makes the text lint's `unresolved-template-token` rule unreachable.
 */
export function detokenize(text: string): DetokenizeResult {
  const droppedLines: string[] = [];
  const replaced = new Set<string>();
  const out: string[] = [];

  for (const line of text.split("\n")) {
    const tokens = [...line.matchAll(TOKEN_RE)].map((m) => m[1]);
    if (tokens.length === 0) {
      out.push(line);
      continue;
    }
    // Any unknown token means we cannot say what the line was meant to convey; dropping
    // it is safer than shipping a half-resolved instruction to a live agent.
    if (tokens.some((t) => !(t in TOKEN_PHRASES))) {
      droppedLines.push(line.trim());
      continue;
    }
    // A line that was nothing but tokens and punctuation carries no instruction once
    // resolved (e.g. "- {{first_name}}"). A LABELLED line keeps its label and is
    // rewritten instead ("- Lead name: [first name]"), because the label is the
    // instruction.
    if (line.replace(TOKEN_RE, "").replace(/[\s\-*_.:,]/g, "").length === 0) {
      droppedLines.push(line.trim());
      continue;
    }
    out.push(
      line.replace(TOKEN_RE, (_m, name: string) => {
        replaced.add(`{{${name}}} -> ${TOKEN_PHRASES[name]}`);
        return TOKEN_PHRASES[name];
      }),
    );
  }

  return { text: out.join("\n"), droppedLines, replaced: [...replaced] };
}

export interface StripResult {
  text: string;
  removed: string[];
}

/**
 * Spoken filler attached mid-line rather than on its own line, e.g.
 * `**Step 4:** call get-available-slots. Speak while it runs: "One sec."`
 * The instruction is worth keeping; the thing to say out loud is not.
 */
const INLINE_SPOKEN_FILLER = /\s*\bspeak(\s+while[^:"]*)?\s*:\s*"[^"]*"\.?/gi;

/** Drop voice-only instruction lines. Everything else is left byte-identical. */
export function stripVoiceIsms(text: string): StripResult {
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const hit = VOICE_ISM_PATTERNS.find((p) => p.pattern.test(line));
    if (hit && line.trim()) {
      removed.push(line.trim().slice(0, 120));
      continue;
    }
    // Reset lastIndex: the regex is module-level and /g is stateful across calls.
    INLINE_SPOKEN_FILLER.lastIndex = 0;
    if (INLINE_SPOKEN_FILLER.test(line)) {
      INLINE_SPOKEN_FILLER.lastIndex = 0;
      const cleaned = line.replace(INLINE_SPOKEN_FILLER, "");
      removed.push(line.trim().slice(0, 120));
      if (cleaned.trim()) out.push(cleaned);
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), removed };
}

/**
 * Replace the voice tooling and call-flow sections with the sanctioned text booking
 * section plus the text style rules.
 *
 * A section runs from its heading to the next heading at the same or higher level, so a
 * `## TOOLS` block ends at the next `##` or `#` and cannot swallow the rest of the doc.
 */
export function swapBookingSection(
  text: string,
  bookingPrompt: string = DEFAULT_TEXT_BOOKING_PROMPT,
  styleBlock: string = TEXT_CHANNEL_STYLE,
): { text: string; removedSections: string[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const removedSections: string[] = [];
  let skipDepth: number | null = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const depth = heading[1].length;
      if (skipDepth !== null && depth <= skipDepth) skipDepth = null;
      if (skipDepth === null && VOICE_SECTION_HEADINGS.test(line)) {
        skipDepth = depth;
        removedSections.push(heading[2].trim().slice(0, 80));
        continue;
      }
    }
    if (skipDepth === null) out.push(line);
  }

  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return {
    text: `${body}\n\n${styleBlock.trim()}\n\n${bookingPrompt.trim()}\n`,
    removedSections,
  };
}

/** Which required compliance lines are missing from the output, byte-for-byte. */
export function assertComplianceVerbatim(
  output: string,
  required: readonly ComplianceLine[],
): { ok: boolean; missing: ComplianceLine[] } {
  const missing = required.filter((c) => !output.includes(c.text));
  return { ok: missing.length === 0, missing };
}

/**
 * Deterministic repair: put the dropped compliance lines back, verbatim, in a block the
 * operator can see. Prepended rather than appended so it cannot be truncated away by a
 * downstream length cap.
 */
export function reassertComplianceLines(
  output: string,
  missing: readonly ComplianceLine[],
): string {
  if (missing.length === 0) return output;
  // One source line can match several kinds (the BFD opener is both the AI disclosure
  // and the recording disclosure), so dedupe by text or the block repeats itself. Strip
  // any bullet the source line already carried, so it does not render as "- - ".
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const c of missing) {
    const text = c.text.replace(/^\s*[-*]\s+/, "");
    if (seen.has(text)) continue;
    seen.add(text);
    bullets.push(`- ${text}`);
  }
  const block = [
    "# COMPLIANCE (VERBATIM, DO NOT EDIT)",
    "",
    "These lines are legal boundaries carried over from the voice agent. Use them as written.",
    "",
    ...bullets,
    "",
  ].join("\n");
  return `${block}\n${output}`;
}

/**
 * A conversion that returns a fraction of the source has not converted anything, it has
 * summarised. Observed live 2026-08-12: a 20,082-char voice doc came back as a 1,439-char
 * greeting that echoed the compliance block and dropped the entire persona, and it linted
 * perfectly clean. Length is the only signal that catches that class, so it is a gate.
 *
 * A text prompt is legitimately shorter than its voice original (tool specs and call
 * flow are stripped), so the floor is deliberately generous.
 */
export const MIN_COVERAGE_RATIO = 0.45;

export interface CoverageResult {
  ok: boolean;
  ratio: number;
  sourceChars: number;
  outputChars: number;
}

export function assessConversionCoverage(sourceChars: number, outputChars: number): CoverageResult {
  const ratio = sourceChars > 0 ? outputChars / sourceChars : 1;
  return {
    ok: sourceChars === 0 ? true : ratio >= MIN_COVERAGE_RATIO,
    ratio: Math.round(ratio * 1000) / 1000,
    sourceChars,
    outputChars,
  };
}

export interface FinalizeResult {
  prompt: string;
  removedVoiceIsms: string[];
  removedSections: string[];
  droppedTokenLines: string[];
  replacedTokens: string[];
  reasserted: ComplianceLine[];
  lint: LintResult;
  coverage: CoverageResult | null;
  ok: boolean;
}

/**
 * Turn the model's draft into a saveable text prompt.
 *
 * Pure, and runs on the OUTPUT: the guarantees hold no matter what the model returned.
 * `ok` mirrors lint.ok, and a false `ok` must block the write (a lint-failing prompt in
 * text_prompts.system_prompt is a live content change with a known-bad prompt, which is
 * the class the 2026-07-03 wrong-booking incident created promptLint to stop).
 */
export function finalizeTextPrompt(args: {
  modelOutput: string;
  compliance: readonly ComplianceLine[];
  bookingPrompt?: string;
  /** Length of the source voice doc. Omit to skip the coverage gate. */
  sourceChars?: number;
}): FinalizeResult {
  const stripped = stripVoiceIsms(args.modelOutput);
  const swapped = swapBookingSection(stripped.text, args.bookingPrompt ?? DEFAULT_TEXT_BOOKING_PROMPT);
  const detokenized = detokenize(swapped.text);

  // Compare against the detokenized form of each required line: a compliance line
  // containing a token cannot survive verbatim AND be lint-clean, and lint-clean wins.
  // Lines without tokens (the real disclosure/recording/NCCP copy) are unchanged, so
  // "byte-identical" still holds for them.
  const required = args.compliance.map((c) => ({ ...c, text: detokenize(c.text).text.trim() }))
    .filter((c) => c.text.length > 0);

  const check = assertComplianceVerbatim(detokenized.text, required);
  const prompt = reassertComplianceLines(detokenized.text, check.missing);
  const lint = lintTextSetterPrompt(prompt);

  // Measure the MODEL's contribution, not the finished file: the appended booking and
  // style blocks are ours and would otherwise pad a gutted conversion over the line.
  const coverage = args.sourceChars === undefined
    ? null
    : assessConversionCoverage(args.sourceChars, args.modelOutput.length);

  return {
    prompt,
    removedVoiceIsms: stripped.removed,
    removedSections: swapped.removedSections,
    droppedTokenLines: detokenized.droppedLines,
    replacedTokens: detokenized.replaced,
    reasserted: check.missing,
    lint,
    coverage,
    ok: lint.ok && (coverage === null || coverage.ok),
  };
}

/** The OpenRouter messages for the conversion job. */
export function buildVoiceToTextMessages(args: {
  voiceDoc: string;
  compliance: readonly ComplianceLine[];
  sourceSlotId: string;
  targetSlotId: string;
  userGuidelines?: string;
}): Array<{ role: "system" | "user"; content: string }> {
  const complianceBlock = args.compliance.length > 0
    ? args.compliance.map((c) => `- (${c.kind}) ${c.text}`).join("\n")
    : "(none detected in the source)";

  // Prompt calibrated against an observed failure (2026-08-12): an earlier wording that
  // led with "PRESERVE THESE LINES" plus the compliance block made the model echo that
  // block as its whole answer and then write a four-line greeting, discarding a
  // 20,082-char persona. Hence: the rewrite instruction comes FIRST, the compliance list
  // is explicitly labelled as a checklist rather than output, and completeness is stated
  // as the primary requirement.
  const system = [
    "You REWRITE a VOICE agent prompt into a TEXT (SMS) agent prompt for the same business.",
    "",
    "THIS IS A FULL REWRITE, NOT A SUMMARY. Work through the source document section by",
    "section, top to bottom, and emit a converted version of EVERY section. Your output must",
    "be a complete, standalone agent prompt of broadly similar length to the source. Never",
    "condense the persona, the company knowledge, the qualification logic, the objection",
    "handling, the guardrails, or the examples into a shorter gist. Never return only an",
    "opening message. Never describe what you would change: emit the prompt itself.",
    "",
    "Keep, unchanged in meaning: identity, company knowledge, qualification logic, objection",
    "handling, guardrails, disqualification rules, and the overall goal.",
    "",
    "Rewrite for text: short messages a person would thumb out, one question per message, no",
    "mention of speaking, calling, hearing, pausing, hold music, or being on the line.",
    "",
    "Remove: spoken filler words, verbal nods, interruption handling, speech pacing, per-tool",
    "'speak while this runs' lines, and tool call body specifications. Booking mechanics are",
    "code-owned on the text side and are appended separately, so do not write your own.",
    "",
    "COMPLIANCE CHECKLIST (these are Australian legal boundaries, not style). Each line below",
    "must appear in your output WORD FOR WORD, character for character, positioned where it",
    "naturally belongs in the converted prompt. Do NOT list them at the top, do NOT repeat",
    "this checklist back, and do NOT reword or shorten them:",
    complianceBlock,
    "",
    "Do not use {{ }} template tokens; the text engine does not substitute them.",
    "Return ONLY the finished prompt in markdown. No preamble, no explanation, no code fence.",
  ].join("\n");

  const user = [
    `Source voice setter: ${args.sourceSlotId}`,
    `Target text setter: ${args.targetSlotId}`,
    args.userGuidelines?.trim() ? `\nOperator guidance: ${args.userGuidelines.trim()}` : "",
    "",
    "--- VOICE PROMPT BEGINS ---",
    args.voiceDoc,
    "--- VOICE PROMPT ENDS ---",
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
