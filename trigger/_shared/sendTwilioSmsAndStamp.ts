import { pushSmsToGhl } from "./ghl-conversations.ts";
import { normalizePhone } from "./phone.ts";
import { isPhoneOptedOut } from "./optout.ts";
import { buildCostEvent } from "./costEvents.ts";

// Seed per-segment SMS cost (USD). Mirrors the 1.4c/SMS seed weight used by the
// cadence_metrics estimate in runEngagement.writeCadenceMetrics. is_estimated=true
// on every SMS cost event flags that this is a rate-card figure, not a Twilio-invoiced
// price — reconcile against real Twilio invoices (BRENDAN_TODO Tier-4) when data exists.
const SMS_SEGMENT_COST_USD_SEED = 0.014;

// ── Shared Twilio SMS sender + message_queue stamp + GHL mirror ───────────
// Extracted from runEngagement.ts so processMessages/sendFollowup can reuse the
// one canonical outbound-SMS path. Sends via the Twilio REST API, stamps the
// outbound message_queue row keyed by twilio_message_sid (the status webhook
// mirrors terminal states back onto it), bumps leads.last_outbound_at for the
// cold-reply nudge task, and mirrors the body into GHL (Conversations API when
// conversationProviderId is set, Notes fallback otherwise). Node runtime only
// (uses Buffer + process.env). WhatsApp keeps using the GHL webhook (separate
// API, not blocking the funnel).
export async function sendTwilioSmsAndStamp(args: {
  supabase: any;
  twilioSid: string;
  twilioAuth: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  clientId: string;
  leadId: string;
  ghlAccountId: string;
  contactName: string | null;
  contactEmail: string | null;
  // Phase B (gap 3) — GHL mirror fields. When ghlApiKey is set, every
  // successful Twilio send is mirrored to the GHL contact (Conversations API
  // when conversationProviderId is set, Notes fallback otherwise).
  ghlApiKey: string | null;
  ghlLocationId: string | null;
  ghlContactId: string | null;
  ghlConversationProviderId: string | null;
  // Synthetic-probe / system client: write the outbound message_queue row the hourly
  // canary asserts, but DO NOT call Twilio (no real SMS, no A2P burn, no spend).
  skipDispatch?: boolean;
  // Session P2 — execution cost ledger. When the send is part of a cadence run these
  // link the SMS cost event to its engagement_execution; ad-hoc sends leave them null.
  executionId?: string | null;
  workflowId?: string | null;
}): Promise<{ ok: boolean; sid: string | null; errorCode?: number; errorMessage?: string }> {
  const supabaseUrl = process.env.SUPABASE_URL!;

  if (args.skipDispatch) {
    const syntheticSid = `PROBE_SKIPPED_${Date.now()}`;
    try {
      await args.supabase.from("message_queue").insert({
        lead_id: args.leadId,
        ghl_account_id: args.ghlAccountId,
        message_body: args.body,
        contact_name: args.contactName,
        contact_email: args.contactEmail,
        contact_phone: args.toNumber,
        channel: "sms_outbound",
        twilio_message_sid: syntheticSid,
        processed: true,
      });
    } catch (insErr) {
      console.warn("sendTwilioSmsAndStamp: probe message_queue insert failed (non-fatal)", insErr);
    }
    try {
      await args.supabase
        .from("leads")
        .update({ last_outbound_at: new Date().toISOString() })
        .eq("client_id", args.clientId)
        .eq("lead_id", args.leadId);
    } catch { /* non-fatal */ }
    console.log(`sendTwilioSmsAndStamp: SMS dispatch SKIPPED (system/probe client) for lead ${args.leadId}; message_queue row written (sid=${syntheticSid})`);
    return { ok: true, sid: syntheticSid };
  }

  // ── Final chokepoint: by-phone lead_optouts gate ──────────────────────────
  // Every send path already has an upstream setter_stopped / opt-out check,
  // but this is the last line of defence before spending Twilio credits.
  // If normalizePhone returns null (unrecognised format) we fall through so
  // we never silently block a legitimate send due to a bad normalisation.
  const normalizedTo = normalizePhone(args.toNumber);
  if (normalizedTo) {
    const optedOut = await isPhoneOptedOut(args.supabase, args.clientId, normalizedTo);
    if (optedOut) {
      console.log(
        `sendTwilioSmsAndStamp: BLOCKED: ${normalizedTo} is in lead_optouts for client ${args.clientId} (lead ${args.leadId})`,
      );
      return { ok: false, sid: null, errorMessage: "opted_out" };
    }
  }

  const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-status-webhook`;
  const params: Record<string, string> = {
    From: args.fromNumber,
    To: args.toNumber,
    Body: args.body,
    StatusCallback: statusCallbackUrl,
  };
  const twilioBody = new URLSearchParams(params);
  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${args.twilioSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${args.twilioSid}:${args.twilioAuth}`).toString("base64")}`,
      },
      body: twilioBody.toString(),
    },
  );
  // Bug 3 — Twilio's REST API returns failed-send fields as `code` + `message`,
  // not `error_code` / `error_message`. Reading the wrong keys silently surfaced
  // failures as "Twilio SMS failed: ? unknown" (e.g. cost 10 min of guessing on
  // a 21610 carrier opt-out 2026-05-13). Keep the helper's external return shape
  // (errorCode / errorMessage) so callers stay unchanged.
  const twilioJson = (await twilioRes.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string; num_segments?: string };
  if (!twilioRes.ok) {
    return { ok: false, sid: null, errorCode: twilioJson.code, errorMessage: twilioJson.message };
  }
  if (twilioJson.sid) {
    // Session P2 — SMS cost event (platform db). Cost is ESTIMATED (segments x seed
    // rate); Twilio's create response carries num_segments but not a settled price.
    // Best-effort + idempotent via UNIQUE(cost_kind, provider_ref=twilio_sid).
    try {
      const segments = Number.parseInt(twilioJson.num_segments ?? "1", 10) || 1;
      const costRow = buildCostEvent("sms", {
        clientId: args.clientId,
        executionId: args.executionId ?? null,
        workflowId: args.workflowId ?? null,
        leadId: args.leadId,
        providerRef: twilioJson.sid,
        quantity: segments,
        unit: "segments",
        costUsd: segments * SMS_SEGMENT_COST_USD_SEED,
        isEstimated: true,
      });
      const { error: costErr } = await args.supabase
        .from("execution_cost_events")
        .upsert(costRow, { onConflict: "cost_kind,provider_ref" });
      if (costErr) console.warn("sendTwilioSmsAndStamp: execution_cost_events write failed (non-fatal)", costErr.message);
    } catch (costEx) {
      console.warn("sendTwilioSmsAndStamp: execution_cost_events write threw (non-fatal)", costEx);
    }
    try {
      await args.supabase.from("message_queue").insert({
        lead_id: args.leadId,
        ghl_account_id: args.ghlAccountId,
        message_body: args.body,
        contact_name: args.contactName,
        contact_email: args.contactEmail,
        contact_phone: args.toNumber,
        channel: "sms_outbound",
        twilio_message_sid: twilioJson.sid,
        processed: true,
      });
    } catch (insErr) {
      console.warn("sendTwilioSmsAndStamp: outbound message_queue insert failed (non-fatal)", insErr);
    }
    // Cadence v2 — bump leads.last_outbound_at for the cold-reply nudge task.
    try {
      await args.supabase
        .from("leads")
        .update({ last_outbound_at: new Date().toISOString() })
        .eq("client_id", args.clientId)
        .eq("lead_id", args.leadId);
    } catch (tsErr) {
      console.warn("sendTwilioSmsAndStamp: last_outbound_at bump failed (non-fatal)", tsErr);
    }
  }
  if (args.ghlApiKey && args.ghlLocationId && args.ghlContactId) {
    const mirrorResult = await pushSmsToGhl({
      ghlApiKey: args.ghlApiKey,
      ghlLocationId: args.ghlLocationId,
      contactId: args.ghlContactId,
      conversationProviderId: args.ghlConversationProviderId,
      message: args.body,
      direction: "outbound",
      altId: twilioJson.sid ?? null,
    });
    if (!mirrorResult.ok) {
      console.warn("sendTwilioSmsAndStamp: GHL mirror non-OK", mirrorResult);
    }
  }
  return { ok: true, sid: twilioJson.sid ?? null };
}
