// nudgeColdReply — Cadence v2 Day 6.
//
// Nightly task that finds leads where the AI setter replied and then the
// lead went silent, and fires an AI-generated nudge SMS to recover them.
// The cadence engine (runEngagement) hands a lead off to processSetterReply
// the moment a reply comes in. After that, nothing nudges them — that's
// the gap this task closes.
//
// Nudge cadence (counted by leads.nudge_count) is per-client config, read from
// the clients row via resolveNudgeConfig (nudge_enabled / nudge_offsets_hours /
// nudge_recovery_window_hours). Defaults preserve the original behaviour:
//   nudge 1 at +24h since last outbound  (gentle re-engagement)
//   nudge 2 at +72h since last outbound  (reframe, ask about underlying goal)
//   then no more SMS; tag the lead silent and stop trying. They drop into the
//   long-tail nurture (Phase B).
// nudge_offsets_hours[i] is the gap (hours since the previous outbound) before
// nudge (i+1); the array length is how many nudges are sent before give-up.
//
// All nudges are AI-generated using the same aiGenerateEngagementCopy
// helper that the active cadence uses. Cost is ~$0.001 per nudge.
//
// Single source of truth for the eligibility filter:
//   nudge_enabled <> false (per client)
//     AND setter_stopped = false
//     AND tagged_silent_after_engagement = false
//     AND last_inbound_at IS NOT NULL
//     AND last_outbound_at > last_inbound_at
//     AND age(now() - last_outbound_at) >= this tier's offset
//     AND age(now() - last_outbound_at) <= recovery window (default 14d)
//     AND nudge_count < number of configured nudges

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { aiGenerateEngagementCopy } from "./_shared/aiGenerateEngagementCopy";
import { normalizePhone } from "./_shared/phone";
import { isPhoneOptedOut } from "./_shared/optout";
import { normalizeLlmModel } from "./_shared/llmModel";
import { appendOptOutFooter } from "./_shared/optOutFooter";
import {
  DEFAULT_QUIET_HOURS,
  resolveLeadTimezone,
  isWithinSendingWindow,
  parseQuietHours,
} from "./_shared/businessHours";
import { isVoiceCallActive } from "./_shared/voiceCallActive";
import { resolveNudgeConfig, NUDGE_COUNT_HARD_CAP } from "./_shared/nudgeConfig";

// SEC-PII-LOGS-1 — keep raw prospect phones out of platform logs.
const redactPhone = (p: string | null | undefined): string => {
  if (!p) return "<no-phone>";
  const s = String(p);
  if (s.length <= 6) return s.slice(0, 2) + "***";
  return s.slice(0, 4) + "***" + s.slice(-3);
};

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

const MAX_LEADS_PER_RUN = 100;

// Per-tier AI intent for the nudge copy. Index = nudge_count at fire time.
// A client can configure more nudges than there are intents here (via
// nudge_offsets_hours); tiers beyond this list reuse the last intent.
const TIER_INTENT = [
  "The lead replied to your last SMS / call about 24h ago but then went quiet on the most recent setter message. Send a SHORT, warm nudge that references what they last said. One sentence + a single low-friction question. Goal: re-open the conversation without restating the original ask.",
  "The lead replied a few days ago and then went silent. They might have lost interest or just got busy. Send ONE message that reframes, asking what the underlying goal or pain is, not whether they're 'still interested'. Avoid 'just checking in' and 'circling back'. Keep it human.",
  "The lead has gone quiet after a couple of nudges. Send ONE final, low-pressure message that simply leaves the door open (offer to help whenever the timing is right). No guilt, no 'last chance', no restating the original ask. Keep it warm and brief.",
];

export const nudgeColdReply = schedules.task({
  id: "nudge-cold-reply",
  // 3.10 — runs HOURLY and gates each nudge on the lead's client-local hour
  // (NUDGE_LOCAL_*). A once-daily fixed-UTC cron would never reach a tenant
  // whose local time at that UTC hour is outside the window (e.g. US-East at
  // 06:00 UTC = 01:00). Hourly is safe: the tier thresholds + nudge_count
  // increment dedup, so a lead is nudged at most once per tier window.
  cron: "0 * * * *",
  maxDuration: 600, // 10 min ceiling
  retry: { maxAttempts: 1 },

  run: async () => {
    const supabase = getMainSupabase();
    const startedAt = Date.now();
    const now = new Date();

    // Pull candidates with their client config in one shot (FK join).
    const { data: candidates, error: queryErr } = await supabase
      .from("leads")
      .select(
        "client_id, lead_id, phone, email, first_name, last_name, business_name, custom_fields, last_inbound_at, last_outbound_at, nudge_count, clients ( id, twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1, openrouter_api_key, llm_model, supabase_url, supabase_service_key, timezone, cadence_quiet_hours, nudge_enabled, nudge_offsets_hours, nudge_recovery_window_hours )",
      )
      .eq("setter_stopped", false)
      .eq("tagged_silent_after_engagement", false)
      // 1C — explicit gate: only nudge leads we sent a reply-expecting message to
      // and who have not replied since. Set by the send paths, cleared on inbound.
      .eq("awaiting_reply", true)
      .not("last_inbound_at", "is", null)
      .not("last_outbound_at", "is", null)
      .lt("nudge_count", NUDGE_COUNT_HARD_CAP)
      .order("last_outbound_at", { ascending: true })
      .limit(MAX_LEADS_PER_RUN);

    if (queryErr) {
      console.error("nudgeColdReply: query failed:", queryErr.message);
      throw new Error(`nudgeColdReply query failed: ${queryErr.message}`);
    }

    type Candidate = NonNullable<typeof candidates>[number];
    const stats = { scanned: 0, nudged: 0, tagged_silent: 0, skipped: 0, errors: 0 };

    for (const lead of (candidates ?? []) as Candidate[]) {
      stats.scanned++;

      // Hard pre-checks (the SQL is best-effort; verify in code).
      if (!lead.last_inbound_at || !lead.last_outbound_at) {
        stats.skipped++;
        continue;
      }
      const lastOut = new Date(lead.last_outbound_at).getTime();
      const lastIn = new Date(lead.last_inbound_at).getTime();
      if (lastOut <= lastIn) {
        // Lead has replied since our last outbound — they're NOT cold.
        stats.skipped++;
        continue;
      }

      const cl = lead.clients as unknown as {
        id: string;
        twilio_account_sid: string | null;
        twilio_auth_token: string | null;
        twilio_default_phone: string | null;
        retell_phone_1: string | null;
        openrouter_api_key: string | null;
        llm_model: string | null;
        supabase_url: string | null;
        supabase_service_key: string | null;
        timezone: string | null;
        cadence_quiet_hours: unknown;
        nudge_enabled: boolean | null;
        nudge_offsets_hours: unknown;
        nudge_recovery_window_hours: number | null;
      } | null;

      // Per-client nudge config (count + spacing + recovery window), defaulting
      // to the original behaviour ([24h, 72h], 14d) for any client that has not
      // tuned it. nudge_enabled=false opts a whole client out of cold nudges.
      const nudgeCfg = resolveNudgeConfig(cl);
      if (!nudgeCfg.enabled) {
        stats.skipped++;
        continue;
      }

      const ageH = (now.getTime() - lastOut) / 3_600_000;
      if (ageH > nudgeCfg.recoveryWindowHours) {
        // Outside recovery window. Tag silent so we stop re-checking, and clear
        // awaiting_reply (1C) so the lead drops out of the nudge query.
        await supabase
          .from("leads")
          .update({ tagged_silent_after_engagement: true, awaiting_reply: false })
          .eq("client_id", lead.client_id!)
          .eq("lead_id", lead.lead_id!);
        stats.tagged_silent++;
        continue;
      }

      const tier = lead.nudge_count ?? 0;

      // Already sent every configured nudge -> give up + tag silent. No SMS.
      if (tier >= nudgeCfg.offsetsHours.length) {
        await supabase
          .from("leads")
          .update({
            tagged_silent_after_engagement: true,
            nudge_count: nudgeCfg.offsetsHours.length,
            // 1C — no longer awaiting a reply; drop out of the nudge query.
            awaiting_reply: false,
          })
          .eq("client_id", lead.client_id!)
          .eq("lead_id", lead.lead_id!);
        stats.tagged_silent++;
        continue;
      }

      const threshold = nudgeCfg.offsetsHours[tier];
      if (ageH < threshold) {
        // Not yet due. A later hourly run picks it up once enough time passes.
        stats.skipped++;
        continue;
      }

      if (!cl?.openrouter_api_key || !cl.twilio_account_sid || !cl.twilio_auth_token) {
        console.warn(
          `nudgeColdReply: client ${lead.client_id} missing creds (openrouter/twilio), skipping ${lead.lead_id}`,
        );
        stats.skipped++;
        continue;
      }
      const fromNumber = cl.twilio_default_phone || cl.retell_phone_1;
      if (!fromNumber || !lead.phone) {
        stats.skipped++;
        continue;
      }

      // HOURS-1: business-hours gate. Uses the SAME source of truth as
      // runEngagement / sendFollowup (the client's cadence_quiet_hours) instead
      // of a hardcoded 9-8 window, resolved to the LEAD's timezone. Checked
      // BEFORE AI generation so we never pay to generate copy we won't send. A
      // later hourly run picks the lead up once it is inside the window.
      const nudgeQuietHours = parseQuietHours(cl.cadence_quiet_hours) ?? DEFAULT_QUIET_HOURS;
      const nudgeClientTz = cl.timezone || null;
      const nudgeEffectiveQH =
        nudgeClientTz && nudgeQuietHours === DEFAULT_QUIET_HOURS
          ? { ...nudgeQuietHours, tz: nudgeClientTz }
          : nudgeQuietHours;
      const nudgeLeadTz = resolveLeadTimezone((lead.phone as string | null) ?? undefined, nudgeEffectiveQH.tz);
      if (!isWithinSendingWindow(now, nudgeEffectiveQH, nudgeLeadTz)) {
        stats.skipped++;
        continue;
      }

      // FOLLOWUP-DURING-CALL-1: don't nudge while the lead is on a live voice
      // call (the agent is talking to them right now). Checked BEFORE AI
      // generation so we never pay for copy we then suppress.
      if (await isVoiceCallActive(supabase, { ghlContactId: lead.lead_id!, clientId: lead.client_id! })) {
        console.log(`nudgeColdReply: voice call active for ${lead.lead_id} — skipping this run.`);
        stats.skipped++;
        continue;
      }

      // Generate the nudge copy. Failure → skip this lead this run.
      let smsBody: string;
      let aiCostCents = 0;
      try {
        const ai = await aiGenerateEngagementCopy({
          openrouterApiKey: cl.openrouter_api_key,
          model: normalizeLlmModel(cl.llm_model) ?? undefined,
          externalSupabaseUrl: cl.supabase_url,
          externalSupabaseServiceKey: cl.supabase_service_key,
          clientId: lead.client_id!,
          leadId: lead.lead_id!,
          firstName: lead.first_name ?? null,
          lastName: lead.last_name ?? null,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          businessName: lead.business_name ?? null,
          customFields: (lead.custom_fields as Record<string, unknown> | null) ?? undefined,
          channelType: "sms",
          nodeIntent: TIER_INTENT[Math.min(tier, TIER_INTENT.length - 1)],
        });
        smsBody = ai.body;
        aiCostCents = ai.costCents;
      } catch (aiErr) {
        console.warn(
          `nudgeColdReply: aiGenerateEngagementCopy failed for ${lead.lead_id}: ${(aiErr as Error).message}`,
        );
        stats.errors++;
        continue;
      }

      // Opt-out recheck: the candidate query filtered setter_stopped=false, but
      // this loop + AI generation take time, so a lead can text STOP before we
      // reach the send. Re-read immediately before spending to avoid messaging
      // an opted-out lead (compliance).
      const { data: freshLead } = await supabase
        .from("leads")
        .select("setter_stopped")
        .eq("client_id", lead.client_id!)
        .eq("lead_id", lead.lead_id!)
        .maybeSingle();
      if (freshLead?.setter_stopped) {
        stats.skipped++;
        continue;
      }
      // By-phone opt-out gate: belt-and-braces against the race window where
      // STOP arrives but setter_stopped has not been stamped yet.
      const normalizedNudgePhone = normalizePhone(lead.phone);
      if (normalizedNudgePhone) {
        const nudgePhoneOptedOut = await isPhoneOptedOut(supabase, lead.client_id!, normalizedNudgePhone);
        if (nudgePhoneOptedOut) {
          console.log(`nudgeColdReply: phone ${redactPhone(normalizedNudgePhone)} is in lead_optouts for lead ${lead.lead_id}, skipping.`);
          stats.skipped++;
          continue;
        }
      }

      // Send via direct Twilio. Mirrors sendTwilioSmsAndStamp's shape so
      // the same StatusCallback path runs. Spam Act opt-out footer on this
      // INITIATED commercial nudge (idempotent; skipped if copy has STOP wording).
      const sendBody = appendOptOutFooter(smsBody);
      const statusCb = `${process.env.SUPABASE_URL}/functions/v1/twilio-status-webhook`;
      const formBody = new URLSearchParams({
        From: fromNumber,
        To: lead.phone!,
        Body: sendBody,
        StatusCallback: statusCb,
      });
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${cl.twilio_account_sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${cl.twilio_account_sid}:${cl.twilio_auth_token}`).toString("base64")}`,
          },
          body: formBody.toString(),
        },
      );
      const tj = (await twilioRes.json().catch(() => ({}))) as {
        sid?: string;
        code?: number;
        message?: string;
      };
      if (!twilioRes.ok || !tj.sid) {
        console.warn(
          `nudgeColdReply: Twilio ${twilioRes.status} for ${lead.lead_id} (client ${lead.client_id}): ${tj.code ?? "?"} ${tj.message ?? "unknown"}`,
        );
        stats.errors++;
        continue;
      }

      // Stamp the lead row: nudge_count++, last_outbound_at, message preview.
      // 1C — the nudge itself expects a reply, so awaiting_reply stays true
      // until the lead replies (which clears it) or we give up.
      const nowIso = new Date().toISOString();
      await supabase
        .from("leads")
        .update({
          nudge_count: tier + 1,
          last_outbound_at: nowIso,
          last_message_at: nowIso,
          last_message_preview: sendBody.slice(0, 200),
          awaiting_reply: true,
        })
        .eq("client_id", lead.client_id!)
        .eq("lead_id", lead.lead_id!);

      // Stamp message_queue so the Twilio status webhook can find the row.
      try {
        await supabase.from("message_queue").insert({
          lead_id: lead.lead_id,
          // The client UUID, matching crm-send-message's fallback: F13 usage
          // metering links sms_outbound rows via ghl_account_id IN
          // (ghl_location_id, client_id); the old lead_id stamp matched
          // neither, so nudge texts were invisible to the count.
          ghl_account_id: lead.client_id ?? lead.lead_id,
          message_body: sendBody,
          contact_phone: lead.phone,
          contact_name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null,
          contact_email: lead.email,
          channel: "sms_outbound",
          twilio_message_sid: tj.sid,
          processed: true,
        });
      } catch (insErr) {
        console.warn(
          "nudgeColdReply: message_queue insert failed (non-fatal)",
          insErr,
        );
      }

      console.log(
        `nudgeColdReply: tier ${tier + 1} nudge sent to ${lead.lead_id} (client ${lead.client_id}, sid=${tj.sid}, ai_cost=${aiCostCents}c)`,
      );
      stats.nudged++;
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `nudgeColdReply done in ${durationMs}ms: scanned=${stats.scanned} nudged=${stats.nudged} tagged_silent=${stats.tagged_silent} skipped=${stats.skipped} errors=${stats.errors}`,
    );
    return { ok: true, duration_ms: durationMs, ...stats };
  },
});
