// Cadence v2 — AI-generated outbound copy for engage channels.
//
// Mirrors the OpenRouter call pattern from processSetterReply.ts but emits
// a single message (with optional subject for email) instead of the
// multi-message JSON shape used by the inbound reply path.
//
// Called from runEngagement.ts when an engage channel has
// `ai_generate: true`. The static `ch.message` field becomes the
// FALLBACK content used if the LLM call errors — never an unhandled throw
// can kill the cadence run.

import { createClient } from "@supabase/supabase-js";

const DEFAULT_MODEL = "openai/gpt-4.1-nano";
const TIMEOUT_MS = 30000;

// gpt-4.1-nano rough pricing (per OpenRouter, 2026-05):
//   $0.10 / 1M prompt tokens   →  $0.0000001 / token
//   $0.40 / 1M completion tokens → $0.0000004 / token
// We hard-code these for the cost estimate; if model changes,
// override via OPENROUTER_PRICE_* (see end of file).
const PRICE_PROMPT_PER_TOKEN_USD = 0.0000001;
const PRICE_COMPLETION_PER_TOKEN_USD = 0.0000004;

export type AiCopyInput = {
  // per-client OpenRouter creds
  openrouterApiKey: string;
  model?: string;
  // per-client external supabase (for chat_history lookup) — optional
  externalSupabaseUrl?: string | null;
  externalSupabaseServiceKey?: string | null;
  // lead identity
  clientId: string;
  leadId: string;
  // lead context (any subset)
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  businessName?: string | null;
  customFields?: Record<string, unknown>;
  // node intent
  channelType: "email" | "sms";
  nodeIntent: string;
  // brand voice (optional override; otherwise a sensible default is used)
  brandVoice?: string | null;
};

export type AiCopyResult = {
  subject?: string;
  body: string;
  costCents: number;
  promptTokens?: number;
  completionTokens?: number;
  model: string;
};

export async function aiGenerateEngagementCopy(args: AiCopyInput): Promise<AiCopyResult> {
  const model = args.model || DEFAULT_MODEL;

  // Pull last ~10 chat_history rows from the external client supabase so
  // the LLM can reference prior conversation naturally. Non-fatal on error.
  let chatHistory: Array<{ role: string; content: string }> = [];
  if (args.externalSupabaseUrl && args.externalSupabaseServiceKey) {
    try {
      const client = createClient(args.externalSupabaseUrl, args.externalSupabaseServiceKey);
      const { data } = await client
        .from("chat_history")
        .select("message, timestamp")
        .eq("session_id", args.leadId)
        .order("timestamp", { ascending: false })
        .limit(10);
      const rows = (data || []).reverse() as Array<{
        message: { type?: string; content?: string } | null;
      }>;
      chatHistory = rows
        .filter((r) => r.message && typeof r.message.content === "string")
        .map((r) => ({
          role: r.message!.type === "human" ? "user" : "assistant",
          content: (r.message!.content as string).slice(0, 400),
        }));
    } catch {
      /* non-fatal — copy generation can proceed without history */
    }
  }

  const systemPrompt = buildSystemPrompt(args);
  const userPrompt = buildUserPrompt(args, chatHistory);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.openrouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        `aiGenerateEngagementCopy OpenRouter ${resp.status}: ${errText.slice(0, 300)}`
      );
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const rawText = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawText) throw new Error("aiGenerateEngagementCopy: empty content from model");

    let parsed: { subject?: string; body?: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(
        `aiGenerateEngagementCopy: model returned non-JSON: ${rawText.slice(0, 200)}`
      );
    }
    if (!parsed.body || typeof parsed.body !== "string" || !parsed.body.trim()) {
      throw new Error(`aiGenerateEngagementCopy: model response missing 'body' field`);
    }

    const pt = json.usage?.prompt_tokens ?? 0;
    const ct = json.usage?.completion_tokens ?? 0;
    const costUsd = pt * PRICE_PROMPT_PER_TOKEN_USD + ct * PRICE_COMPLETION_PER_TOKEN_USD;
    const costCents = Math.max(0, Math.round(costUsd * 100 * 100) / 100); // round to 0.01¢
    return {
      subject: parsed.subject?.trim() || undefined,
      body: parsed.body.trim(),
      costCents,
      promptTokens: pt,
      completionTokens: ct,
      model,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSystemPrompt(args: AiCopyInput): string {
  const channelInstructions = args.channelType === "email"
    ? `Write a concise email. Return JSON with a 'subject' field (≤60 chars, no quotes, sentence-case) and a 'body' field (plain text or simple HTML — paragraphs only, no inline styling, no images, no tables). Subject should be specific and benefit-oriented; never use "Quick question" or "Following up".`
    : `Write a short SMS (≤300 chars total). Return JSON with a 'body' field ONLY (plain text, no HTML, no markdown). DO NOT include a 'subject' field. Be conversational, like one human texting another. Don't end with sign-offs like "Best regards" or "Sincerely".`;

  const brandVoice =
    args.brandVoice?.trim() ||
    `Warm and direct. Australian English (use "mate", "keen", "gday" sparingly only if it fits naturally). Like a founder personally reaching out. Never sound salesy or scripted. Use the lead's first name once if available.`;

  return `You write outbound sales messages for an AI setter platform. These messages fire inside a multi-touch cadence on a high-intent inbound lead who has already filled out a form requesting info.

BRAND VOICE:
${brandVoice}

CHANNEL: ${args.channelType.toUpperCase()}
${channelInstructions}

CRITICAL RULES:
- The lead has ALREADY enquired. Do NOT introduce yourself from scratch.
- Do NOT use "I hope this finds you well" or other corporate filler.
- If conversation history is provided, reference it naturally — never restart the conversation.
- Keep it human, specific, and short.
- Return ONLY valid JSON. No commentary, no markdown fences, no text outside the JSON object.`;
}

function buildUserPrompt(
  args: AiCopyInput,
  chatHistory: Array<{ role: string; content: string }>,
): string {
  const lines: string[] = [];
  lines.push(`Lead context:`);
  if (args.firstName) lines.push(`- First name: ${args.firstName}`);
  if (args.lastName) lines.push(`- Last name: ${args.lastName}`);
  if (args.businessName) lines.push(`- Business: ${args.businessName}`);
  if (args.email) lines.push(`- Email: ${args.email}`);
  if (args.phone) lines.push(`- Phone: ${args.phone}`);
  if (args.customFields && Object.keys(args.customFields).length > 0) {
    lines.push(`- Other:`);
    for (const [k, v] of Object.entries(args.customFields)) {
      if (v != null && typeof v !== "object") lines.push(`  - ${k}: ${v}`);
    }
  }

  if (chatHistory.length > 0) {
    lines.push(``);
    lines.push(`Conversation so far (most recent last):`);
    for (const m of chatHistory) {
      lines.push(`- ${m.role}: ${m.content}`);
    }
  }

  lines.push(``);
  lines.push(`TOUCH INTENT for this message:`);
  lines.push(args.nodeIntent);
  lines.push(``);
  lines.push(`Write the ${args.channelType === "email" ? "email" : "SMS"} now. Return JSON only.`);
  return lines.join("\n");
}
