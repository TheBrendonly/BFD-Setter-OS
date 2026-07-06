// nudgeColdReply — Cadence v2 Day 6.
//
// Nightly task that finds leads where the AI setter replied and then the
// lead went silent, and fires an AI-generated nudge SMS to recover them.
// The cadence engine (runEngagement) hands a lead off to processSetterReply
// the moment a reply comes in. After that, nothing nudges them — that's
// the gap this task closes.
//
// Nudge tiers (counted by leads.nudge_count):
//   nudge 1 at +24h since last outbound  (gentle re-engagement)
//   nudge 2 at +72h since last outbound  (reframe — ask about underlying goal)
//   tier 3 at +7d  → no SMS; just tag the lead and stop trying. They drop
//                    into the long-tail nurture (Phase B).
//
// All nudges are AI-generated using the same aiGenerateEngagementCopy
// helper that the active cadence uses. Cost is ~$0.001 per nudge.
//
// Single source of truth for the eligibility filter (mirrors plan §
// cold-reply re-engagement):
//   setter_stopped = false
//     AND tagged_silent_after_engagement = false
//     AND last_inbound_at IS NOT NULL
//     AND last_outbound_at > last_inbound_at
//     AND age(now() - last_outbound_at) >= tier-threshold
//     AND age(now() - last_outbound_at) <= 14d   (outside recovery window)
//     AND nudge_count < 3

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { aiGenerateEngagementCopy } from "./_shared/aiGenerateEngagementCopy";
import { normalizePhone } from "./_shared/phone";
import { isPhoneOptedOut } from "./_shared/optout";
import { normalizeLlmModel } from "./_shared/llmModel";
import {
  DEFAULT_QUIET_HOURS,
  resolveLeadTimezone,
  isWithinQuietHoursWindow,
  parseQuietHours,
} from "./_shared/businessHours";
import { isVoiceCallActive } from "./_shared/voiceCallActive";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

// Hours since last_outbound_at required for each tier. Index = nudge_count
// at task-fire time. tier 3 (index 2) is the give-up state.
const TIER_THRESHOLDS_HOURS = [24, 72, 168]; // 1d, 3d, 7d
const RECOVERY_WINDOW_HOURS = 24 * 14;       // skip leads >14d cold
const MAX_LEADS_PER_RUN = 100;

const TIER_INTENT = [
  "The lead replied to your last SMS / call about 24h ago but then went quiet on the most recent setter message. Send a SHORT, warm nudge that references what they last said. One sentence + a single low-friction question. Goal: re-open the conversation without restating the original ask.",
  "The lead replied a few days ago and then went silent. They might have lost interest or just got busy. Send ONE message that reframes — ask what the underlying goal or pain is, not whether they're 'still interested'. Avoid 'just checking in' and 'circling back'. Keep it human.",
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
        "client_id, lead_id, phone, email, first_name, last_name, business_name, custom_fields, last_inbound_at, last_outbound_at, nudge_count, clients ( id, twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1, openrouter_api_key, llm_model, supabase_url, supabase_service_key, timezone, cadence_quiet_hours )",
      )
      .eq("setter_stopped", false)
      .eq("tagged_silent_after_engagement", false)
      .not("last_inbound_at", "is", null)
      .not("last_outbound_at", "is", null)
      .lt("nudge_count", 3)
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

      const ageH = (now.getTime() - lastOut) / 3_600_000;
      if (ageH > RECOVERY_WINDOW_HOURS) {
        // Outside recovery window. Tag silent so we stop re-checking.
        await supabase
          .from("leads")
          .update({ tagged_silent_after_engagement: true })
          .eq("client_id", lead.client_id!)
          .eq("lead_id", lead.lead_id!);
        stats.tagged_silent++;
        continue;
      }

      const tier = (lead.nudge_count ?? 0) as 0 | 1 | 2;
      const threshold = TIER_THRESHOLDS_HOURS[tier];
      if (ageH < threshold) {
        // Not yet due. Tomorrow's run may pick it up.
        stats.skipped++;
        continue;
      }

      // Tier 3 — give up + tag. No SMS sent.
      if (tier >= 2) {
        await supabase
          .from("leads")
          .update({ tagged_silent_after_engagement: true, nudge_count: 3 })
          .eq("client_id", lead.client_id!)
          .eq("lead_id", lead.lead_id!);
        stats.tagged_silent++;
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
      } | null;

      if (!cl?.openrouter_api_key || !cl.twilio_account_sid || !cl.twilio_auth_token) {
        console.warn(
          `nudgeColdReply: client ${lead.client_id} missing creds (openrouter/twilio) — skipping ${lead.lead_id}`,
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
      if (!isWithinQuietHoursWindow(now, nudgeEffectiveQH, nudgeLeadTz)) {
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
          nodeIntent: TIER_INTENT[tier],
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
          console.log(`nudgeColdReply: phone ${normalizedNudgePhone} is in lead_optouts for lead ${lead.lead_id}, skipping.`);
          stats.skipped++;
          continue;
        }
      }

      // Send via direct Twilio. Mirrors sendTwilioSmsAndStamp's shape so
      // the same StatusCallback path runs.
      const statusCb = `${process.env.SUPABASE_URL}/functions/v1/twilio-status-webhook`;
      const formBody = new URLSearchParams({
        From: fromNumber,
        To: lead.phone!,
        Body: smsBody,
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
      const nowIso = new Date().toISOString();
      await supabase
        .from("leads")
        .update({
          nudge_count: tier + 1,
          last_outbound_at: nowIso,
          last_message_at: nowIso,
          last_message_preview: smsBody.slice(0, 200),
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
          message_body: smsBody,
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
