// analyze-sms-conversation (6.12b SMS path)
//
// LLM-classifies a lead's SMS conversation (sentiment / intent / qualified /
// summary) and writes the result to the lead's GHL contact custom fields, then
// stamps leads.last_sms_analyzed_at. Self-contained — it never touches the SMS
// engine (processMessages / receive-twilio-sms). Two modes:
//   - targeted: POST { client_id, lead_id }  (JWT-owner or service-role auth)
//   - scan:     POST {}                        (service-role only; driven by the
//               analyzeSmsConversations Trigger task) — processes due leads.
//
// "Due" = a lead with SMS activity since its last analysis whose thread has
// settled (no new message for SCAN_IDLE_MS). The pure logic lives in
// smsAnalysis.ts; this file is orchestration.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { writeGhlContactFields } from "../_shared/ghl-conversations.ts";
import {
  authorizeClientRequest,
  AssertAccessError,
  grantsServiceRole,
} from "../_shared/authorize-client-request.ts";
import {
  buildSmsAnalysisMessages,
  buildSmsConversationText,
  buildSmsFieldWrites,
  normalizeModel,
  parseSmsAnalysis,
  type SmsMsg,
} from "./smsAnalysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SMS_CHANNELS = ["sms_inbound", "sms_outbound", "sms"];
const SCAN_IDLE_MS = 10 * 60 * 1000; // only analyse settled threads
const SCAN_LIMIT = 50; // leads per scan run
const MIN_MESSAGES = 2; // skip trivial threads
const MAX_MESSAGES = 40; // cap prompt size
const DEFAULT_MODEL = "openai/gpt-4.1-nano";
const LLM_TIMEOUT_MS = 20_000;

const CLIENT_COLUMNS =
  "id, ghl_api_key, ghl_location_id, openrouter_api_key, llm_model, " +
  "ghl_sms_sentiment_field_id, ghl_sms_intent_field_id, ghl_sms_qualified_field_id, ghl_sms_summary_field_id";

// deno-lint-ignore no-explicit-any
type Supa = any;
// deno-lint-ignore no-explicit-any
type ClientRow = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ok = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({})) as { client_id?: string; lead_id?: string };
    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    const leadId = typeof body.lead_id === "string" ? body.lead_id : null;
    const authHeader = req.headers.get("Authorization");

    // ── Targeted mode ──
    if (clientId && leadId) {
      await authorizeClientRequest(authHeader, clientId); // throws AssertAccessError
      const clientRow = await loadClient(supabase, clientId);
      if (!clientRow) return ok({ ok: false, error: "client_not_found" }, 404);
      const analyzed = await analyzeOne(supabase, clientRow, leadId);
      return ok({ ok: true, mode: "targeted", analyzed });
    }

    // ── Scan mode (service-role only) ──
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isServiceRole = !!token &&
      (token === serviceKey || (token.startsWith("sb_secret_") && await grantsServiceRole(token)));
    if (!isServiceRole) return ok({ ok: false, error: "Forbidden" }, 403);

    const result = await scan(supabase);
    return ok({ ok: true, mode: "scan", ...result });
  } catch (e) {
    if (e instanceof AssertAccessError) {
      return ok({ ok: false, error: e.message }, e.status);
    }
    console.error("analyze-sms-conversation error:", e);
    return ok({ ok: false, error: (e as Error).message });
  }
});

async function loadClient(supabase: Supa, clientId: string): Promise<ClientRow | null> {
  const { data } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
  return data ?? null;
}

// Analyse a single lead's SMS thread for a given (already-loaded) client.
// Always stamps the watermark so a settled/empty thread isn't re-scanned until
// it gets new activity. Returns 1 if GHL fields were written, else 0.
async function analyzeOne(supabase: Supa, client: ClientRow, leadId: string): Promise<number> {
  const ghlAccountId = client.ghl_location_id as string | null;
  let wrote = 0;
  try {
    const { data: rows } = await supabase
      .from("message_queue")
      .select("message_body, channel, created_at")
      .eq("lead_id", leadId)
      .eq("ghl_account_id", ghlAccountId)
      .in("channel", SMS_CHANNELS)
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES);

    const messages: SmsMsg[] = (rows ?? [])
      .filter((r: { message_body?: string | null }) => typeof r.message_body === "string" && r.message_body.trim() !== "")
      .map((r: { message_body: string; channel: string | null }) => ({
        // message_queue stores inbound LEAD sms as channel "sms" and outbound SETTER
        // sms as "sms_outbound" (see receive-twilio-sms vs sendTwilioSmsAndStamp/
        // crm-send-message). Testing includes("inbound") mislabelled every inbound
        // "sms" row as the Setter, so the analyser scored a role-swapped, one-sided
        // transcript. Only an "*outbound" channel is the Setter; everything else
        // ("sms", "sms_inbound") is the Lead.
        direction: (r.channel ?? "").includes("outbound") ? "outbound" : "inbound",
        body: r.message_body,
      }));

    const apiKey = client.openrouter_api_key as string | null;
    if (messages.length >= MIN_MESSAGES && apiKey) {
      const analysis = await classify(messages, apiKey, normalizeModel(client.llm_model as string | null) || DEFAULT_MODEL);
      if (analysis) {
        const writes = buildSmsFieldWrites(analysis, {
          sentiment: client.ghl_sms_sentiment_field_id as string | null,
          intent: client.ghl_sms_intent_field_id as string | null,
          qualified: client.ghl_sms_qualified_field_id as string | null,
          summary: client.ghl_sms_summary_field_id as string | null,
        });
        if (writes.length > 0 && client.ghl_api_key) {
          const res = await writeGhlContactFields({
            ghlApiKey: client.ghl_api_key as string,
            contactId: leadId,
            fields: writes,
          });
          if (res.ok && !res.skipped) wrote = 1;
          else if (!res.ok) console.warn(`analyze-sms: GHL field write non-OK for ${leadId}: ${res.status ?? "-"} ${res.error ?? ""}`);
        }
      }
    }
  } catch (e) {
    console.warn(`analyze-sms: analyzeOne failed for ${leadId} (non-fatal):`, e);
  } finally {
    // Watermark regardless of outcome so we don't re-scan until new activity.
    await supabase
      .from("leads")
      .update({ last_sms_analyzed_at: new Date().toISOString() })
      .eq("client_id", client.id)
      .eq("lead_id", leadId);
  }
  return wrote;
}

async function classify(messages: SmsMsg[], apiKey: string, model: string) {
  const chat = buildSmsAnalysisMessages(buildSmsConversationText(messages));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: chat, temperature: 0.2 }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`analyze-sms: OpenRouter non-OK ${resp.status}`);
      return null;
    }
    const json = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json?.choices?.[0]?.message?.content?.trim() ?? "";
    return parseSmsAnalysis(raw);
  } catch (e) {
    console.warn("analyze-sms: OpenRouter call failed:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Scan due leads: SMS activity since last analysis, thread settled. last_message_at
// is also bumped by voice calls, so voice-only leads do a cheap no-op SMS query —
// acceptable; a message_queue-sourced scan is a future optimisation.
async function scan(supabase: Supa): Promise<{ scanned: number; wrote: number }> {
  const settledBefore = new Date(Date.now() - SCAN_IDLE_MS).toISOString();
  const { data: leads } = await supabase
    .from("leads")
    .select("client_id, lead_id, last_message_at, last_sms_analyzed_at")
    .not("last_message_at", "is", null)
    .lt("last_message_at", settledBefore)
    .order("last_message_at", { ascending: true })
    .limit(SCAN_LIMIT);

  const due = (leads ?? []).filter((l: { last_message_at: string; last_sms_analyzed_at: string | null }) =>
    !l.last_sms_analyzed_at || new Date(l.last_message_at) > new Date(l.last_sms_analyzed_at)
  );

  const clientCache = new Map<string, ClientRow | null>();
  let scanned = 0;
  let wrote = 0;
  for (const lead of due) {
    const cid = lead.client_id as string;
    if (!clientCache.has(cid)) clientCache.set(cid, await loadClient(supabase, cid));
    const client = clientCache.get(cid);
    if (!client) continue;
    scanned++;
    wrote += await analyzeOne(supabase, client, lead.lead_id as string);
  }
  return { scanned, wrote };
}
