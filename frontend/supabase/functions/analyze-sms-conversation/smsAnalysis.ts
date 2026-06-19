// Pure helpers for analyze-sms-conversation (6.12b SMS path).
// No I/O — unit-testable. The edge function orchestrates: read the SMS thread,
// call OpenRouter with buildSmsAnalysisMessages, parseSmsAnalysis the reply,
// then writeGhlContactFields(buildSmsFieldWrites(...)).

export type SmsMsg = { direction: "inbound" | "outbound"; body: string };

export type SmsAnalysis = {
  sentiment: string | null;
  intent: string | null;
  qualified: boolean | null;
  summary: string | null;
};

export type SmsFieldIds = {
  sentiment?: string | null;
  intent?: string | null;
  qualified?: string | null;
  summary?: string | null;
};

const SMS_ANALYSIS_SYSTEM_PROMPT =
  "You analyse a two-way SMS conversation between a sales Setter and a Lead. " +
  "Reply with ONLY a single JSON object, no prose, no code fences, with exactly these keys: " +
  '"sentiment" (one word: positive | neutral | negative), ' +
  '"intent" (a short phrase describing what the lead wants, e.g. interested, not_interested, wants_callback, booked, question), ' +
  '"qualified" (boolean true/false — whether the lead is a qualified prospect worth pursuing), ' +
  '"summary" (1-2 sentence summary of the conversation). ' +
  "If the conversation is too short or empty to judge a field, use null for that field.";

/** Render the SMS thread as a labelled transcript for the analyser. */
export function buildSmsConversationText(messages: SmsMsg[]): string {
  return messages
    .map((m) => `${m.direction === "inbound" ? "Lead" : "Setter"}: ${m.body}`)
    .join("\n");
}

/** Chat messages for the OpenRouter call. */
export function buildSmsAnalysisMessages(
  conversationText: string,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SMS_ANALYSIS_SYSTEM_PROMPT },
    { role: "user", content: conversationText },
  ];
}

function coerceStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes") return true;
    if (s === "false" || s === "no") return false;
  }
  return null;
}

/** Parse the LLM reply (tolerating code fences / surrounding prose) → analysis. */
export function parseSmsAnalysis(raw: string): SmsAnalysis | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  return {
    sentiment: coerceStr(obj.sentiment),
    intent: coerceStr(obj.intent),
    qualified: coerceBool(obj.qualified),
    summary: coerceStr(obj.summary),
  };
}

/** Map the parsed analysis to GHL custom-field writes, dropping unset ids/values. */
export function buildSmsFieldWrites(
  analysis: SmsAnalysis,
  fieldIds: SmsFieldIds,
): Array<{ id: string; value: string }> {
  const writes: Array<{ id: string; value: string }> = [];
  const push = (id: string | null | undefined, value: string | null | undefined) => {
    if (id && typeof value === "string" && value.trim() !== "") writes.push({ id, value });
  };
  push(fieldIds.sentiment, analysis.sentiment);
  push(fieldIds.intent, analysis.intent);
  push(fieldIds.qualified, analysis.qualified === true ? "true" : analysis.qualified === false ? "false" : null);
  push(fieldIds.summary, analysis.summary);
  return writes;
}
