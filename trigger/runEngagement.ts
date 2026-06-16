import { task, wait } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { placeOutboundCall } from "./placeOutboundCall";
import { pushEmailToGhl } from "./_shared/ghl-conversations";
import { sendTwilioSmsAndStamp } from "./_shared/sendTwilioSmsAndStamp";
import { aiGenerateEngagementCopy } from "./_shared/aiGenerateEngagementCopy";
import { classifyCallOutcome } from "./_shared/classifyCallOutcome";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const redactBody = (b: string | null | undefined): string => {
  if (b == null) return "<empty>";
  const s = String(b);
  return `[redacted body, ${s.length} chars]`;
};

type EngageChannel = {
  type: "sms" | "whatsapp" | "phone_call" | "email";
  enabled: boolean;
  message: string;
  delay_seconds: number;
  // WhatsApp-specific fields
  whatsapp_type?: "template" | "text"; // defaults to "text" if absent
  template_name?: string;              // only used when whatsapp_type === "template"
  // Phone-call-specific fields
  voice_setter_id?: string;            // slot_id like "Voice-Setter-2"
  instructions?: string;               // custom call instructions
  treat_pickup_as_reply?: boolean;     // end sequence when human answers
  // Email-specific fields (Cadence v2)
  subject?: string;                    // email subject line (used when ai_generate=false)
  body_format?: "html" | "text";       // defaults to "html"
  from_email?: string;                 // per-channel from override
  // AI-generated copy (Cadence v2 Day 4-5). When ai_generate is true the
  // runtime calls aiGenerateEngagementCopy with ai_prompt as the touch
  // intent and uses the LLM output as the message (and subject for email).
  // The static `message` and `subject` fields are kept as fallback content
  // if the AI call fails.
  ai_generate?: boolean;
  ai_prompt?: string;                  // short description of the touch intent
  // Voicemail behaviour is handled by Retell natively (phase-11d) — see
  // engagement_workflows.voicemail_config + make-retell-outbound-call's
  // ensureVoicemailConfig PATCH. The legacy Twilio AMD voicemail-drop
  // branch was removed.
};

type VoicemailConfig = {
  mode: "static" | "dynamic";
  message: string;
} | null;

type EngagementNode =
  | { id: string; type: "delay"; delay_seconds: number }
  // Legacy flat node types (kept for backwards compatibility)
  | { id: string; type: "send_sms"; message: string }
  | { id: string; type: "send_whatsapp"; message: string }
  | { id: string; type: "phone_call"; instructions: string }
  // Current grouped node type used by the workflow builder
  | { id: string; type: "engage"; message: string; channels: EngageChannel[] }
  | { id: string; type: "wait_for_reply"; timeout_seconds: number }
  | { id: string; type: "drip"; batch_size: number; interval_seconds: number };

// ── Phase 4b — Quiet hours ─────────────────────────────────────────────────
// clients.cadence_quiet_hours jsonb shape (per Docs/CADENCE_DESIGN.md):
//   { "start": "09:00", "end": "21:00", "tz": "Australia/Brisbane",
//     "days": [1,2,3,4,5] }   // 1=Mon ... 7=Sun
type QuietHoursConfig = {
  start: string; // HH:MM
  end: string;   // HH:MM
  tz: string;    // IANA
  days: number[]; // 1..7
};

const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  start: "09:00",
  end: "21:00",
  tz: "Australia/Brisbane",
  days: [1, 2, 3, 4, 5, 6, 7],
};

const PHONE_TZ_PREFIX_MAP: Record<string, string> = {
  "+61": "Australia/Brisbane",
  "+1":  "America/New_York",
  "+44": "Europe/London",
  "+64": "Pacific/Auckland",
  "+353": "Europe/Dublin",
  "+27": "Africa/Johannesburg",
};

function resolveLeadTimezone(phone: string | undefined, clientDefaultTz: string): string {
  if (!phone) return clientDefaultTz;
  // Sort prefixes by length descending so +353 wins over +1
  const prefixes = Object.keys(PHONE_TZ_PREFIX_MAP).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (phone.startsWith(prefix)) return PHONE_TZ_PREFIX_MAP[prefix];
  }
  return clientDefaultTz;
}

function isWithinQuietHoursWindow(now: Date, qh: QuietHoursConfig, tz: string): boolean {
  const localStr = now.toLocaleString("en-US", { timeZone: tz });
  const local = new Date(localStr);
  // 1=Mon..7=Sun
  const dayJs = local.getDay();
  const day = dayJs === 0 ? 7 : dayJs;
  if (!qh.days.includes(day)) return false;
  const cur = local.toTimeString().slice(0, 5);
  const overnight = qh.start > qh.end;
  if (overnight) return cur >= qh.start || cur <= qh.end;
  return cur >= qh.start && cur <= qh.end;
}

// Step forward in 5-minute increments to keep the loop cheap; max 14 days
function getNextQuietHoursStart(now: Date, qh: QuietHoursConfig, tz: string): Date {
  if (isWithinQuietHoursWindow(now, qh, tz)) return now;
  let probe = new Date(now);
  const stepMs = 5 * 60_000;
  const maxIters = (14 * 24 * 60) / 5;
  for (let i = 0; i < maxIters; i++) {
    probe = new Date(probe.getTime() + stepMs);
    if (isWithinQuietHoursWindow(probe, qh, tz)) return probe;
  }
  // 14d soft cap — return now to avoid forever-park
  return now;
}

function parseQuietHours(raw: unknown): QuietHoursConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const start = typeof r.start === "string" ? r.start : null;
  const end = typeof r.end === "string" ? r.end : null;
  const tz = typeof r.tz === "string" ? r.tz : null;
  const days = Array.isArray(r.days) ? r.days.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7) : null;
  if (!start || !end || !tz || !days || days.length === 0) return null;
  return { start, end, tz, days };
}

// Cadence v2 — workflow-level schedule gating. Shape mirrors ScheduleConfig
// at the bottom of this file (0=Sun..6=Sat per Date.getDay()). The
// getScheduleAwareBatchTime / getNextScheduleWindow helpers expect this
// exact field shape — keep them in sync.
function parseSchedule(raw: unknown): ScheduleConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const timezone = typeof r.timezone === "string" ? r.timezone : null;
  const start_time = typeof r.start_time === "string" ? r.start_time : null;
  const end_time = typeof r.end_time === "string" ? r.end_time : null;
  const days = Array.isArray(r.days)
    ? r.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : null;
  if (!timezone || !start_time || !end_time || !days || days.length === 0) return null;
  return { timezone, start_time, end_time, days };
}

// ── Phase 11d — GHL tag removal at cadence end ────────────────────────────
// When a workflow is the new-leads auto-enrol campaign and a contact was
// enrolled via tag, the tag represents "currently in cadence". When the
// cadence ends for ANY reason (sequence_complete, inbound_reply,
// booking_created, opt_out, cancelled, error), the tag is no longer truth
// and should be removed from the GHL contact. Best-effort, non-blocking.
async function removeNewLeadsTag(args: {
  ghlApiKey: string;
  contactId: string;
  tagName: string;
}): Promise<void> {
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/contacts/${args.contactId}/tags`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${args.ghlApiKey}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ tags: [args.tagName] }),
      },
    );
    if (!r.ok && r.status !== 404) {
      const txt = await r.text().catch(() => "");
      console.warn(`removeNewLeadsTag non-2xx ${r.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn(`removeNewLeadsTag failed (non-fatal): ${(e as Error).message}`);
  }
}

// ── Bug 1 — wait for Retell call_ended before advancing cadence ───────────
// retell-call-webhook stamps engagement_executions.last_call_outcome on
// call_ended (see frontend/supabase/functions/retell-call-webhook/index.ts).
// Poll until the matching call_id appears, or hard ceiling fires.
// wait.for is frozen — zero compute during the wait.
type CallOutcome = {
  call_id?: string | null;
  disconnect_reason?: string | null;
  call_status?: string | null;
  ended_at?: string | null;
  // Bug 33 — required to classify ghost-connects vs real human pickups.
  // Will be null if Bug 20 (call_ended subscribe) hasn't been wired into the
  // writer yet; classifier treats null as 0 and biases toward no_connect.
  duration_ms?: number | null;
  transcript_turns?: number | null;
  in_voicemail?: boolean | null;
};

async function waitForCallOutcome(args: {
  supabase: any;
  executionId: string;
  callId: string;
  isCancelled: () => Promise<boolean>;
  maxWaitSeconds?: number;
  pollIntervalSeconds?: number;
}): Promise<CallOutcome | "cancelled" | null> {
  const maxWaitMs = (args.maxWaitSeconds ?? 600) * 1000;
  const pollInterval = args.pollIntervalSeconds ?? 15;
  const startMs = Date.now();
  while (Date.now() - startMs < maxWaitMs) {
    await wait.for({ seconds: pollInterval });
    if (await args.isCancelled()) return "cancelled";
    const { data: pollRow } = await args.supabase
      .from("engagement_executions")
      .select("last_call_outcome")
      .eq("id", args.executionId)
      .maybeSingle();
    const lc = pollRow?.last_call_outcome as CallOutcome | null;
    if (lc?.call_id === args.callId) return lc;
  }
  return null;
}

// Bug 33 — call outcome classifier moved to ./_shared/classifyCallOutcome.ts.
// Byte-identical clone at frontend/supabase/functions/retell-call-analysis-webhook/classifyCallOutcome.ts.
// If you change one, change the other.

export const runEngagement = task({
  id: "run-engagement",
  // maxDuration only counts active CPU time — wait.until() is frozen (zero compute,
  // zero duration). So 3600s here means 1 hour of actual execution across the whole
  // sequence, which is more than enough even for very long campaigns.
  maxDuration: 3600,
  // No auto-retry — execution state is fully stateful in DB.
  // If a node fails, Trigger.dev will retry the whole task from the beginning,
  // but each node checks for cancellation and the drip position is idempotent
  // (claiming the same position twice is safe — see claim_drip_position RPC).
  retry: { maxAttempts: 2 },

  run: async (payload: {
    // GHL-style field names — consistent with how GHL sends data everywhere
    execution_id: string;
    Lead_ID: string;
    GHL_Account_ID: string;
    client_id: string;
    workflow_id: string;
    campaign_id: string;
    Name?: string;
    Email?: string;
    Phone?: string;
    // Optional flat map of extra contact fields (snake_case keys) for custom field substitution
    contact_fields?: Record<string, string>;
    // Push Now: skip nodes before this index (resumes after the node that was waiting)
    start_from_node_index?: number;
    // Supabase edge function URL for firing outbound Retell calls
    make_retell_call_url?: string;
  }) => {
    const supabase = getMainSupabase();
    const {
      execution_id,
      Lead_ID: lead_id,
      GHL_Account_ID: ghl_account_id,
      client_id,
      workflow_id,
      campaign_id,
      Name: contact_name,
    } = payload;

    const updateExecution = async (fields: Record<string, unknown>) => {
      await supabase
        .from("engagement_executions")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", execution_id);
    };

    // Check if execution was cancelled externally (Stop button, STOP keyword,
    // or inbound reply). Also checks leads.setter_stopped as a belt-and-braces
    // guard: if STOP arrives mid-cadence, receive-twilio-sms sets setter_stopped
    // before endActiveCadences runs — without this check, an already-queued node
    // can fire before the cadence row is updated.
    const isCancelled = async (): Promise<boolean> => {
      const [execRes, leadRes] = await Promise.all([
        supabase
          .from("engagement_executions")
          .select("status")
          .eq("id", execution_id)
          .single(),
        supabase
          .from("leads")
          .select("setter_stopped")
          .eq("client_id", client_id)
          .eq("lead_id", lead_id)
          .maybeSingle(),
      ]);
      const execData = execRes.data;
      if (!execData) return true;
      if (
        execData.status === "cancelled" ||
        execData.status === "stopped" ||
        execData.status === "replied" ||
        // Any terminal status set by another actor (e.g. bookings-webhook marks
        // the exec completed with stop_reason='booking_created') must stop this
        // run, even if the external Trigger.dev run-cancel call never landed.
        execData.status === "completed" ||
        execData.status === "failed"
      ) {
        return true;
      }
      if (leadRes.data?.setter_stopped === true) {
        // Self-cancel the exec so analytics + UI reflect the opt-out cleanly.
        await supabase
          .from("engagement_executions")
          .update({
            status: "cancelled",
            stop_reason: "setter_stopped",
            completed_at: new Date().toISOString(),
            stage_description: "Cancelled — lead opted out (setter_stopped).",
          })
          .eq("id", execution_id);
        return true;
      }
      return false;
    };

    // A pause (status='paused', set by pause-engagement) is NON-terminal: unlike the
    // statuses isCancelled() catches, a paused run must exit WITHOUT finalizing
    // cadence_metrics so resume-engagement can re-trigger it from last_completed+1.
    // The Trigger.dev run-cancel issued by pause-engagement is the primary stop; this
    // boundary check is the backstop for the window between status='paused' and the
    // cancel landing (the most common case: paused while looping between nodes).
    const isPaused = async (): Promise<boolean> => {
      const { data } = await supabase
        .from("engagement_executions")
        .select("status")
        .eq("id", execution_id)
        .single();
      return data?.status === "paused";
    };

    // Log a campaign analytics event — non-fatal if it fails (table may not exist yet).
    const logCampaignEvent = async (fields: {
      event_type: "enrolled" | "message_sent" | "completed";
      channel?: string;
      node_index?: number;
      node_id?: string;
      metadata?: Record<string, unknown>;
    }) => {
      try {
        await supabase.from("campaign_events").insert({
          client_id,
          campaign_id,
          execution_id,
          lead_id,
          event_type: fields.event_type,
          channel: fields.channel ?? null,
          node_index: fields.node_index ?? null,
          node_id: fields.node_id ?? null,
          occurred_at: new Date().toISOString(),
          metadata: fields.metadata ?? null,
        });
      } catch (err) {
        console.error(`logCampaignEvent failed: ${(err as Error).message}`);
        // Never block the engagement sequence for an analytics write failure
      }
    };

    // CAD-01 — per-channel send markers. The campaign_events row written right
    // after each send doubles as an idempotency marker: when a task retry
    // replays a node (its last_completed_node_index was never written), any
    // sms/whatsapp/email send already stamped 'message_sent' for this
    // (execution, node) is skipped instead of re-sent. Returns counts per
    // channel so a node with two channels of the same type stays correct.
    // phone_call is intentionally NOT marker-skipped: the placement itself is
    // deduped inside make-retell-outbound-call via idempotency_key, so a
    // replay re-enters the normal wait/classify flow with the same call_id.
    const getSentChannelCounts = async (nodeIndex: number): Promise<Map<string, number>> => {
      const counts = new Map<string, number>();
      try {
        const { data, error } = await supabase
          .from("campaign_events")
          .select("channel")
          .eq("execution_id", execution_id)
          .eq("node_index", nodeIndex)
          .eq("event_type", "message_sent");
        if (error) {
          // supabase-js returns PostgREST failures in-band (no throw) — log
          // them here or a failed marker read would be completely silent.
          console.warn(`getSentChannelCounts read failed (treating as none sent): ${error.message}`);
          return counts;
        }
        for (const row of (data ?? []) as Array<{ channel: string | null }>) {
          const ch = row.channel ?? "";
          counts.set(ch, (counts.get(ch) ?? 0) + 1);
        }
      } catch (err) {
        // Treat a marker-read failure as "nothing sent" — the worst case is
        // one duplicate send, the same guarantee level as before this guard.
        console.warn(`getSentChannelCounts failed (treating as none sent): ${(err as Error).message}`);
      }
      return counts;
    };

    // Build a flat variable map for template substitution.
    // Any key in this map can be referenced as {{key}} in message templates.
    // Priority: GHL payload fields first, then any extra contact_fields from the edge function.
    const firstName = (contact_name ?? "").trim().split(/\s+/)[0] || "";
    const varMap: Record<string, string> = {
      first_name: firstName,
      name: contact_name ?? "",
      phone: payload.Phone ?? "",
      email: payload.Email ?? "",
      // Spread any additional fields (custom fields, business_name, etc.) passed by edge function
      ...(payload.contact_fields ?? {}),
    };

    // Replace {{key}} (case-insensitive) using varMap; unknown variables are left as-is.
    const interpolate = (text: string) =>
      text.replace(/\{\{(\w+)\}\}/gi, (match, key: string) => {
        const lower = key.toLowerCase();
        return Object.prototype.hasOwnProperty.call(varMap, lower) ? varMap[lower] : match;
      });

    // Phase 11d — workflow + client are loaded inside the try block. Hold
    // lateinit bindings here so writeCadenceMetrics can reach them when it
    // fires the GHL tag-removal step at every terminal stop_reason.
    let workflowRow: {
      nodes: unknown;
      name: string;
      quiet_hours_override?: unknown;
      voicemail_config?: unknown;
      is_new_leads_campaign?: boolean;
      new_leads_tag?: string | null;
    } | null = null;
    let clientRow: {
      send_engagement_webhook_url?: string | null;
      supabase_url?: string | null;
      supabase_service_key?: string | null;
      cadence_quiet_hours?: unknown;
      twilio_account_sid?: string | null;
      twilio_auth_token?: string | null;
      twilio_default_phone?: string | null;
      retell_phone_1?: string | null;
      ghl_api_key?: string | null;
      ghl_location_id?: string | null;
    } | null = null;

    // ── Phase 7e — cadence_metrics buffer ──────────────────────────────────
    // Counters are buffered in this object across the run; written to
    // cadence_metrics once on completion / cancellation (whichever exit
    // the task takes, including the catch block below).
    const metricsBuffer = {
      nodes_fired: 0,
      sms_sent: 0,
      sms_delivered: 0, // mirrored from sms_delivery_events at write time
      whatsapp_sent: 0,
      emails_sent: 0, // Cadence v2
      ai_cost_cents: 0, // Cadence v2 — Day 4-5 AI-generated copy
      calls_attempted: 0,
      calls_picked_up: 0, // mirrored from voice_call_logs at write time
      voicemails_dropped: 0,
      reply_received: false,
      time_to_first_response_seconds: null as number | null,
      booking_created: false,
      booking_id: null as string | null,
      time_to_booking_seconds: null as number | null,
    };
    const runStartedAt = Date.now();

    const writeCadenceMetrics = async (stopReason: string) => {
      try {
        // Best-effort: read the final exec row + cancellation reason
        const { data: execRow } = await supabase
          .from("engagement_executions")
          .select("status, stop_reason, completed_at, last_completed_node_index")
          .eq("id", execution_id)
          .maybeSingle();
        const finalStop = execRow?.stop_reason ?? stopReason;

        // Hydrate sms_delivered + calls_picked_up from authoritative tables
        // (cheap one-shot reads keyed by execution_id / lead_id).
        let smsDelivered = metricsBuffer.sms_sent; // optimistic default
        try {
          const { count: deliveredCount } = await supabase
            .from("sms_delivery_events")
            .select("twilio_message_sid", { count: "exact", head: true })
            .eq("client_id", client_id)
            .eq("status", "delivered")
            .gte("received_at", new Date(runStartedAt).toISOString());
          if (typeof deliveredCount === "number") smsDelivered = deliveredCount;
        } catch { /* ignore */ }

        // booking_created / booking_id: look up the latest bookings row for
        // (client_id, lead_id) keyed to this execution.
        let bookingCreated = metricsBuffer.booking_created;
        let bookingId = metricsBuffer.booking_id;
        let timeToBookingSeconds = metricsBuffer.time_to_booking_seconds;
        if (finalStop === "booking_created" || metricsBuffer.booking_created) {
          try {
            const { data: bookingRow } = await supabase
              .from("bookings")
              .select("id, created_at")
              .eq("client_id", client_id)
              .eq("lead_id", lead_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (bookingRow) {
              bookingCreated = true;
              bookingId = bookingRow.id as string;
              const bookedAt = new Date(bookingRow.created_at as string).getTime();
              if (!Number.isNaN(bookedAt)) {
                timeToBookingSeconds = Math.max(0, Math.round((bookedAt - runStartedAt) / 1000));
              }
            }
          } catch { /* ignore */ }
        }

        await supabase
          .from("cadence_metrics")
          .upsert(
            {
              execution_id,
              client_id,
              workflow_id,
              lead_id,
              nodes_fired: metricsBuffer.nodes_fired,
              sms_sent: metricsBuffer.sms_sent,
              sms_delivered: smsDelivered,
              whatsapp_sent: metricsBuffer.whatsapp_sent,
              emails_sent: metricsBuffer.emails_sent,
              ai_cost_cents: metricsBuffer.ai_cost_cents,
              // Cadence v2 Day 7 — rough cost estimate. Conservative
              // weights: SMS=1.4c (Twilio AU avg), email=0.5c (GHL
              // Conversations or SMTP), voice=50c (Retell ~$0.07/min × ~7
              // min avg attempt incl. ring time), whatsapp=1c. AI cost
              // already in cents. Alerts at >500c via error_logs (see
              // post-upsert guard below).
              cost_estimate_cents:
                Math.round(metricsBuffer.sms_sent * 1.4) +
                Math.round(metricsBuffer.emails_sent * 0.5) +
                metricsBuffer.calls_attempted * 50 +
                metricsBuffer.whatsapp_sent +
                metricsBuffer.ai_cost_cents,
              calls_attempted: metricsBuffer.calls_attempted,
              calls_picked_up: metricsBuffer.calls_picked_up,
              voicemails_dropped: metricsBuffer.voicemails_dropped,
              reply_received: metricsBuffer.reply_received || finalStop === "inbound_reply",
              time_to_first_response_seconds: metricsBuffer.time_to_first_response_seconds,
              booking_created: bookingCreated,
              booking_id: bookingId,
              time_to_booking_seconds: timeToBookingSeconds,
              ended_at: new Date().toISOString(),
              stop_reason: finalStop,
            },
            { onConflict: "execution_id" },
          );

        // Cadence v2 Day 7 — cost-ceiling alert. Fires only on completed
        // runs (the calculation is finalized here). 500c = $5/lead, well
        // above the modelled $2.50/lead ceiling. Investigation-trigger,
        // not a runtime hard stop.
        const costCents =
          Math.round(metricsBuffer.sms_sent * 1.4) +
          Math.round(metricsBuffer.emails_sent * 0.5) +
          metricsBuffer.calls_attempted * 50 +
          metricsBuffer.whatsapp_sent +
          metricsBuffer.ai_cost_cents;
        if (costCents > 500) {
          try {
            await supabase.from("error_logs").insert({
              client_ghl_account_id: ghl_account_id,
              error_type: "cadence_cost_ceiling",
              error_message: `Cadence run cost estimate ${costCents}c exceeds 500c ceiling`,
              severity: "warning",
              source: "trigger.runEngagement.writeCadenceMetrics",
              execution_id,
              lead_id,
              context: {
                cost_estimate_cents: costCents,
                sms_sent: metricsBuffer.sms_sent,
                emails_sent: metricsBuffer.emails_sent,
                calls_attempted: metricsBuffer.calls_attempted,
                whatsapp_sent: metricsBuffer.whatsapp_sent,
                ai_cost_cents: metricsBuffer.ai_cost_cents,
                stop_reason: finalStop,
              },
            });
          } catch { /* non-fatal */ }
        }

        // D2 (4.4) — per-tenant ROLLING cost ceiling (flag-only, no auto-pause).
        // The cadence_metrics upsert above is already counted, so client_cost_rollup
        // reflects this run. Only checked when the client has a ceiling configured.
        try {
          const { data: clientCeil } = await supabase
            .from("clients")
            .select("weekly_cost_ceiling_cents, monthly_cost_ceiling_cents")
            .eq("id", client_id)
            .maybeSingle();
          const weeklyCeil = clientCeil?.weekly_cost_ceiling_cents ?? null;
          const monthlyCeil = clientCeil?.monthly_cost_ceiling_cents ?? null;
          if (weeklyCeil != null || monthlyCeil != null) {
            const { data: rollup } = await supabase
              .from("client_cost_rollup")
              .select("week_cents, month_cents")
              .eq("client_id", client_id)
              .maybeSingle();
            const weekCents = Number(rollup?.week_cents ?? 0);
            const monthCents = Number(rollup?.month_cents ?? 0);
            const weeklyBreached = weeklyCeil != null && weekCents >= weeklyCeil;
            const monthlyBreached = monthlyCeil != null && monthCents >= monthlyCeil;
            if (weeklyBreached || monthlyBreached) {
              // Throttle: one breach log per client per UTC day. The rolling
              // ceiling stays breached for the rest of the period, so without
              // this every later cadence completion would re-log the breach.
              const dayStartIso = (() => {
                const d = new Date();
                d.setUTCHours(0, 0, 0, 0);
                return d.toISOString();
              })();
              const { data: loggedToday } = await supabase
                .from("error_logs")
                .select("id")
                .eq("client_ghl_account_id", ghl_account_id)
                .eq("error_type", "cost_ceiling_breach")
                .gte("created_at", dayStartIso)
                .limit(1);
              if (!loggedToday || loggedToday.length === 0) {
                await supabase.from("error_logs").insert({
                  client_ghl_account_id: ghl_account_id,
                  error_type: "cost_ceiling_breach",
                  error_message:
                    `Tenant rolling cost ceiling reached ` +
                    `(week ${weekCents}c/${weeklyCeil ?? "n/a"}c, month ${monthCents}c/${monthlyCeil ?? "n/a"}c)`,
                  severity: "warning",
                  source: "trigger.runEngagement.writeCadenceMetrics",
                  execution_id,
                  lead_id,
                  context: {
                    week_cents: weekCents,
                    month_cents: monthCents,
                    weekly_ceiling_cents: weeklyCeil,
                    monthly_ceiling_cents: monthlyCeil,
                  },
                });
              }
            }
          }
        } catch { /* non-fatal */ }
      } catch (metricsErr) {
        console.warn("writeCadenceMetrics failed (non-fatal):", (metricsErr as Error).message);
      }

      // Phase 11d — tag removal at every terminal stop_reason. Best-effort
      // and intentionally fires on ALL terminal states (the tag means
      // "currently in cadence" so once we exit, the tag is no longer truth).
      try {
        if (
          workflowRow?.is_new_leads_campaign &&
          typeof workflowRow.new_leads_tag === "string" &&
          workflowRow.new_leads_tag.trim() &&
          clientRow?.ghl_api_key &&
          lead_id
        ) {
          await removeNewLeadsTag({
            ghlApiKey: clientRow.ghl_api_key,
            contactId: lead_id,
            tagName: workflowRow.new_leads_tag.trim(),
          });
        }
      } catch (tagErr) {
        console.warn("removeNewLeadsTag wrapper failed (non-fatal):", (tagErr as Error).message);
      }
    };

    try {
      // ── Load workflow ─────────────────────────────────────────────────────
      const { data: workflow } = await supabase
        .from("engagement_workflows")
        .select("nodes, name, quiet_hours_override, voicemail_config, is_new_leads_campaign, new_leads_tag, schedule")
        .eq("id", workflow_id)
        .single();

      if (!workflow?.nodes) {
        throw new Error(`Engagement workflow ${workflow_id} not found or has no nodes`);
      }
      workflowRow = workflow as unknown as typeof workflowRow;

      const nodes = workflow.nodes as EngagementNode[];
      // Cadence v2 — workflow-level schedule gating (e.g., "Mon-Fri 9am-5pm
      // Sydney only"). The runtime primitives (getScheduleAwareBatchTime,
      // getNextScheduleWindow) have always been built; this hooks them up.
      const schedule = parseSchedule((workflow as any).schedule);

      // ── Load client config ────────────────────────────────────────────────
      const { data: client } = await supabase
        .from("clients")
        .select("send_engagement_webhook_url, supabase_url, supabase_service_key, cadence_quiet_hours, twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1, ghl_api_key, ghl_location_id, ghl_conversation_provider_id, openrouter_api_key, llm_model, timezone, brand_voice, is_system")
        .eq("id", client_id)
        .single();

      if (!client) {
        throw new Error(`Client ${client_id} not found`);
      }
      clientRow = client as unknown as typeof clientRow;
      // Phase 11f — SMS now goes via direct Twilio. WhatsApp still requires
      // send_engagement_webhook_url; we validate that in the WhatsApp branch
      // and require Twilio creds in the SMS branch.

      // Phase 11d — quiet-hours fallback chain: workflow override wins, then
      // per-client default, then DEFAULT_QUIET_HOURS.
      // UI Gap 18 — if the resolved quiet-hours doesn't specify a timezone
      // (or only has a hand-coded one that doesn't match the client), default
      // the tz to clients.timezone so the cadence respects the client's
      // declared timezone instead of the legacy Australia/Brisbane fallback.
      const baseQuietHours =
        parseQuietHours((workflow as any).quiet_hours_override) ??
        parseQuietHours(client.cadence_quiet_hours) ??
        DEFAULT_QUIET_HOURS;
      const clientTz = typeof (client as any).timezone === "string" && (client as any).timezone
        ? (client as any).timezone as string
        : null;
      const quietHours = clientTz && baseQuietHours === DEFAULT_QUIET_HOURS
        ? { ...baseQuietHours, tz: clientTz }
        : baseQuietHours;

      // Voicemail config travels through to make-retell-outbound-call so it
      // can PATCH the agent's voicemail_option before placing each call.
      const voicemailConfig: VoicemailConfig = (() => {
        const raw = (workflow as any).voicemail_config;
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        if ((r.mode === "static" || r.mode === "dynamic") && typeof r.message === "string" && r.message.trim()) {
          return { mode: r.mode as "static" | "dynamic", message: r.message };
        }
        return null;
      })();
      const leadTz = resolveLeadTimezone(payload.Phone, quietHours.tz);

      const enforceQuietHoursBeforeSend = async (label: string): Promise<boolean> => {
        const now = new Date();
        if (isWithinQuietHoursWindow(now, quietHours, leadTz)) return true;
        const resumeAt = getNextQuietHoursStart(now, quietHours, leadTz);
        const waitSecs = Math.max(0, Math.round((resumeAt.getTime() - Date.now()) / 1000));
        const localTime = resumeAt.toLocaleTimeString("en-US", {
          timeZone: leadTz,
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        });
        console.log(`Quiet-hours gate (${label}): outside window — waiting ${waitSecs}s until ${localTime} (${leadTz})`);
        await updateExecution({
          stage_description: `Outside quiet hours — resuming at ${localTime}`,
        });
        await wait.until({ date: resumeAt });
        return false;
      };

      // External Supabase client for writing outbound messages to chat_history
      const clientSupabase =
        client.supabase_url && client.supabase_service_key
          ? createClient(client.supabase_url as string, client.supabase_service_key as string)
          : null;

      const writeToChatHistory = async (messageText: string) => {
        if (!clientSupabase) return;
        try {
          await clientSupabase.from("chat_history").insert({
            session_id: lead_id,
            message: {
              type: "ai",
              content: messageText,
              tool_calls: [],
              additional_kwargs: {},
              response_metadata: {},
              invalid_tool_calls: [],
            },
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error(`Failed to write engagement message to chat_history: ${(err as Error).message}`);
          // Non-fatal — message was already sent, don't fail the engagement
        }
      };

      // ── Load campaign text setter number ──────────────────────────────────
      // Stored on engagement_campaigns.text_setter_number (smallint, default 1).
      // Defaults to 1 if the column doesn't exist yet or the campaign isn't found.
      const { data: campaign } = await supabase
        .from("engagement_campaigns")
        .select("text_setter_number")
        .eq("id", campaign_id)
        .maybeSingle();
      const textSetterNumber: number = (campaign?.text_setter_number as number | null) ?? 1;

      // ── Read last completed node for retry-safe resume ───────────────────
      // last_completed_node_index is updated AFTER each node finishes.
      // On a retry Trigger.dev restarts from the top of run(), so we read
      // this from the DB to know which nodes already completed and skip them.
      // This prevents re-sending messages that were already sent in a prior attempt.
      const { data: execState } = await supabase
        .from("engagement_executions")
        .select("last_completed_node_index")
        .eq("id", execution_id)
        .single();

      const lastCompleted = execState?.last_completed_node_index ?? null;

      // Priority: explicit Push Now payload > DB-tracked last completed > 0
      const resumeFromIndex =
        payload.start_from_node_index !== undefined
          ? payload.start_from_node_index
          : lastCompleted !== null
          ? lastCompleted + 1
          : 0;

      if (resumeFromIndex > 0) {
        console.log(
          `Engagement ${execution_id}: resuming from node ${resumeFromIndex} ` +
          `(last_completed=${lastCompleted}, push_now=${payload.start_from_node_index})`
        );
      }

      await updateExecution({
        status: "running",
        current_node_index: resumeFromIndex,
        started_at: new Date().toISOString(),
        stage_description: resumeFromIndex > 0
          ? `Resuming from node ${resumeFromIndex}...`
          : "Starting engagement sequence...",
      });

      // Log enrollment only on the first run (not on retries that resume mid-sequence)
      if (resumeFromIndex === 0) {
        await logCampaignEvent({ event_type: "enrolled" });
      }

      // ── Execute nodes sequentially ────────────────────────────────────────
      for (let i = 0; i < nodes.length; i++) {
        // Skip nodes already completed (retry resume or Push Now)
        if (i < resumeFromIndex) {
          continue;
        }

        // Exit cleanly on a pause request — non-terminal, so do NOT finalize metrics;
        // resume-engagement re-triggers from last_completed+1.
        if (await isPaused()) {
          console.log(`Engagement ${execution_id} paused at node ${i}`);
          return { status: "paused", node_index: i };
        }

        // Check for external cancellation before every node
        if (await isCancelled()) {
          console.log(`Engagement ${execution_id} cancelled at node ${i}`);
          await writeCadenceMetrics("cancelled");
          return { status: "cancelled", node_index: i };
        }

        const node = nodes[i];
        await updateExecution({ current_node_index: i });

        console.log(`Engagement ${execution_id}: node ${i} type=${node.type}`);

        // ── DRIP node ───────────────────────────────────────────────────────
        // Must be the first node (or early in the sequence) — it batches leads
        // by assigning each one a position in a shared queue. Leads in batch 0
        // proceed immediately; batch 1 waits one interval; batch 2 waits two, etc.
        if (node.type === "drip") {
          await updateExecution({ stage_description: "Drip: claiming batch slot..." });

          // Atomically claim a position in this campaign's drip queue.
          // The RPC handles concurrent enrollments safely via row-level locking.
          const { data: dripResult, error: dripError } = await supabase
            .rpc("claim_drip_position", {
              p_client_id: client_id,
              p_workflow_id: workflow_id,
              p_node_id: node.id,
              p_campaign_id: campaign_id,
              p_batch_size: node.batch_size,
              p_interval_seconds: node.interval_seconds,
            });

          if (dripError) {
            throw new Error(`Failed to claim drip position: ${dripError.message}`);
          }

          const { position, started_at } = dripResult as { position: number; started_at: string };
          const batchNumber = Math.floor(position / node.batch_size);

          // Calculate fire time — schedule-aware if a schedule is configured.
          // Without schedule: pure math offset from campaign start.
          // With schedule: intervals only count during working hours so batches
          // that would land outside hours are pushed to the next window opening,
          // preventing a rush of simultaneous sends at the start of the next day.
          const firesAt = schedule
            ? getScheduleAwareBatchTime(
                batchNumber,
                new Date(started_at),
                node.interval_seconds,
                schedule
              )
            : new Date(new Date(started_at).getTime() + batchNumber * node.interval_seconds * 1000);

          console.log(
            `Drip: campaign=${campaign_id} position=${position} batch=${batchNumber} fires_at=${firesAt.toISOString()} schedule_aware=${!!schedule}`
          );

          if (firesAt > new Date()) {
            const waitSecs = Math.round((firesAt.getTime() - Date.now()) / 1000);
            await updateExecution({
              stage_description: `Drip: batch ${batchNumber + 1} — waiting ${formatDuration(waitSecs)}...`,
            });
            await wait.until({ date: firesAt });
          } else {
            console.log(`Drip: batch ${batchNumber} already due — proceeding immediately`);
          }

        // ── DELAY node ──────────────────────────────────────────────────────
        } else if (node.type === "delay") {
          const resumeAt = new Date(Date.now() + node.delay_seconds * 1000);
          await updateExecution({
            stage_description: `Waiting ${formatDuration(node.delay_seconds)}...`,
          });
          await wait.until({ date: resumeAt });

        // ── ENGAGE node ─────────────────────────────────────────────────────
        // Groups SMS, WhatsApp, and phone call channels with per-channel delays.
        // Channels are executed in order; only enabled channels fire.
        } else if (node.type === "engage") {
          // Phase 4b — quiet hours gate (always-on per-client fallback).
          await enforceQuietHoursBeforeSend(`engage node ${i}`);
          if (await isCancelled()) { await writeCadenceMetrics("cancelled"); return { status: "cancelled", node_index: i }; }

          // ── Schedule gate: wait until the next allowed send window ──────────
          if (schedule) {
            const nextWindow = getNextScheduleWindow(new Date(), schedule);
            if (nextWindow !== null) {
              const waitSecs = Math.round((nextWindow.getTime() - Date.now()) / 1000);
              const localTime = nextWindow.toLocaleTimeString("en-US", {
                timeZone: schedule.timezone,
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short",
              });
              console.log(
                `Schedule gate: outside window — waiting ${formatDuration(waitSecs)} until ${localTime}`
              );
              await updateExecution({
                stage_description: `Outside sending hours — resuming at ${localTime}`,
              });
              await wait.until({ date: nextWindow });
              if (await isCancelled()) { await writeCadenceMetrics("cancelled"); return { status: "cancelled", node_index: i }; }
            }
          }

          const enabledChannels = node.channels.filter((ch) => ch.enabled);

          // CAD-01 — on a retry that replays this node, skip channels whose
          // send already went out in a prior attempt (campaign_events marker).
          // phone_call is excluded: its placement is deduped downstream via
          // idempotency_key so the wait/classify flow must still run.
          const sentCounts = await getSentChannelCounts(i);
          const seenByType = new Map<string, number>();

          for (let ci = 0; ci < enabledChannels.length; ci++) {
            const ch = enabledChannels[ci];

            if (ch.type !== "phone_call") {
              const typePos = seenByType.get(ch.type) ?? 0;
              seenByType.set(ch.type, typePos + 1);
              if (typePos < (sentCounts.get(ch.type) ?? 0)) {
                console.log(
                  `Engage node ${i}: skipping ${ch.type} channel ${ci} — already sent in a prior attempt (CAD-01 marker)`
                );
                continue;
              }
            }

            // Wait the inter-channel delay (skip for the first channel)
            if (ci > 0 && ch.delay_seconds > 0) {
              const chResumeAt = new Date(Date.now() + ch.delay_seconds * 1000);
              await updateExecution({
                stage_description: `Engage: waiting ${formatDuration(ch.delay_seconds)} before ${ch.type}...`,
              });
              await wait.until({ date: chResumeAt });
            }

            if (await isCancelled()) {
              console.log(`Engagement ${execution_id} cancelled during engage node`);
              await writeCadenceMetrics("cancelled");
              return { status: "cancelled", node_index: i };
            }

            if (ch.type === "phone_call") {
              // Phase 11d — voicemail is now Retell-native (voicemail_option
              // PATCHed onto the agent inside make-retell-outbound-call before
              // each call). The legacy Twilio AMD voicemail-drop branch was
              // removed. voicemail_config (workflow-level) flows through
              // placeOutboundCall → make-retell-outbound-call.
              if (!payload.make_retell_call_url) {
                throw new Error("phone_call channel requires make_retell_call_url in payload");
              }
              if (!ch.voice_setter_id) {
                throw new Error(`phone_call channel in node ${node.id} is missing voice_setter_id`);
              }
              // DEPRECATED (2026-05-31): persona-slot voice-setter override.
              // The try_gary_persona_slots mechanism is retired — nothing sets
              // voice_setter_id_override anymore, so this read is inert and
              // always falls through to the channel's voice_setter_id. Kept as
              // a harmless defensive read; can be removed on the next trigger
              // deploy. Agent selection is now per-campaign (tag-per-campaign).
              const overrideVoiceSetterId =
                (payload.contact_fields as Record<string, string> | undefined)?.voice_setter_id_override;
              const effectiveVoiceSetterId = overrideVoiceSetterId || ch.voice_setter_id;
              await updateExecution({ stage_description: "Queued for outbound call..." });
              const callRun = await placeOutboundCall.triggerAndWait({
                make_retell_call_url: payload.make_retell_call_url,
                client_id,
                voice_setter_id: effectiveVoiceSetterId,
                ghl_contact_id: lead_id,
                ghl_account_id,
                execution_id,
                // CAD-02 — dedup key: a retry of this exact cadence step must
                // not dial the lead a second time.
                idempotency_key: `${execution_id}:${i}:${ci}`,
                custom_instructions: interpolate(ch.instructions || ""),
                contact_fields: payload.contact_fields || {},
                treat_pickup_as_reply: ch.treat_pickup_as_reply ?? false,
                voicemail_config: voicemailConfig,
              }, {
                // CAD-02 — a parent retry must re-attach to the SAME child run
                // instead of spawning a concurrent sibling that races the
                // edge-fn dedup guard (both dialing before either stamps).
                idempotencyKey: `place:${execution_id}:${i}:${ci}`,
              });
              if (callRun.ok !== true) {
                const failure = callRun as { error?: unknown };
                throw new Error(`place-outbound-call failed: ${String(failure.error ?? "unknown")}`);
              }
              const callId = callRun.output?.call_id;
              const callWasDeduped = callRun.output?.already_placed === true;
              console.log(
                `Engage phone_call ${callWasDeduped ? "replayed (deduped, no new dial)" : "placed"} for ${lead_id}: call_id=${callId}`
              );
              if (!callWasDeduped) {
                // Cadence v2 — bump leads.last_outbound_at for cold-reply nudge accounting.
                try {
                  await supabase
                    .from("leads")
                    .update({ last_outbound_at: new Date().toISOString() })
                    .eq("client_id", client_id)
                    .eq("lead_id", lead_id);
                } catch (tsErr) {
                  console.warn("runEngagement: last_outbound_at bump (engage call) failed (non-fatal)", tsErr);
                }
                metricsBuffer.calls_attempted++;
                await logCampaignEvent({
                  event_type: "message_sent",
                  channel: "phone_call",
                  node_index: i,
                  node_id: node.id,
                  metadata: { call_id: callId, voice_setter_id: effectiveVoiceSetterId },
                });
              }

              // Bug 1 — wait for call_ended before advancing.
              if (callId) {
                // active_call_id is the hold signal: the text setter (processMessages)
                // waits while this is non-null; retell-call-webhook clears it on call_ended.
                await updateExecution({ stage_description: "Call in progress — awaiting outcome...", active_call_id: callId });
                const waitResult = await waitForCallOutcome({
                  supabase,
                  executionId: execution_id,
                  callId,
                  isCancelled,
                  pollIntervalSeconds: 5,
                });
                if (waitResult === "cancelled") {
                  console.log(`Engagement ${execution_id} cancelled during phone_call wait`);
                  await writeCadenceMetrics("cancelled");
                  return { status: "cancelled", node_index: i };
                }
                if (waitResult === null) {
                  console.warn(
                    `Engagement ${execution_id}: call ${callId} outcome timed out — assuming missed`
                  );
                }
                const outcomeClass = classifyCallOutcome(waitResult);
                console.log(
                  `Engagement ${execution_id}: call ${callId} outcome=${outcomeClass} ` +
                  `(disconnect=${waitResult?.disconnect_reason ?? "?"}, status=${waitResult?.call_status ?? "?"})`
                );
                if (outcomeClass === "human_pickup") {
                  metricsBuffer.calls_picked_up++;
                  if (ch.treat_pickup_as_reply) {
                    await updateExecution({
                      status: "completed",
                      stop_reason: "call_engaged",
                      stage_description: "Call answered by human — engagement complete.",
                      completed_at: new Date().toISOString(),
                      last_completed_node_index: i,
                      active_call_id: null,
                    });
                    await writeCadenceMetrics("call_engaged");
                    return { status: "completed", stop_reason: "call_engaged" };
                  }
                }
              }

              // Clear the voice-call hold whenever we stop waiting on the
              // call. Normally retell-call-webhook clears it on call_ended,
              // but a deduped replay (already_placed) re-arms it AFTER that
              // webhook fired, and the outcome-timeout path never clears it —
              // a stale hold suppresses stop-on-reply and delays the text
              // setter's replies by up to 15 minutes. Idempotent with the
              // webhook's own clear.
              await updateExecution({ stage_description: "Phone call ended.", active_call_id: null });
              continue;
            }

            // Cadence v2 Day 4-5 — AI-generated copy. When ch.ai_generate is
            // true, call the LLM with lead context + node intent and override
            // message (+ subject for email) with the result. Falls back to
            // the static ch.message / ch.subject on any error so a single
            // bad LLM call can't kill the whole cadence run.
            let message = interpolate(ch.message);
            let aiSubject: string | undefined = undefined;
            if (ch.ai_generate && (ch.type === "sms" || ch.type === "email")) {
              const orKey = (client as any).openrouter_api_key as string | null;
              if (!orKey) {
                console.warn(
                  `runEngagement: ai_generate channel in node ${node.id} but client has no openrouter_api_key — falling back to static template`,
                );
              } else {
                try {
                  const ai = await aiGenerateEngagementCopy({
                    openrouterApiKey: orKey,
                    model: (client as any).llm_model as string | undefined,
                    externalSupabaseUrl: (client as any).supabase_url as string | null,
                    externalSupabaseServiceKey: (client as any).supabase_service_key as string | null,
                    clientId: client_id,
                    leadId: lead_id,
                    firstName: firstName || null,
                    email: payload.Email || null,
                    phone: payload.Phone || null,
                    businessName: payload.contact_fields?.business_name || null,
                    customFields: payload.contact_fields,
                    channelType: ch.type as "sms" | "email",
                    nodeIntent: interpolate(ch.ai_prompt || ch.message || ""),
                    brandVoice: (client as any).brand_voice as string | null,
                  });
                  message = ai.body;
                  aiSubject = ai.subject;
                  metricsBuffer.ai_cost_cents += ai.costCents;
                  console.log(
                    `Engage AI-generated ${ch.type} for ${lead_id}: cost=${ai.costCents}c tokens=${ai.promptTokens}/${ai.completionTokens} (node ${node.id})`,
                  );
                } catch (aiErr) {
                  console.warn(
                    `runEngagement: aiGenerateEngagementCopy failed in node ${node.id} (${ch.type}) — falling back to static. Error: ${(aiErr as Error).message}`,
                  );
                }
              }
            }
            const channelLabel = ch.type === "sms" ? "SMS" : ch.type === "whatsapp" ? "WhatsApp" : "email";
            await updateExecution({ stage_description: `Sending ${channelLabel}...` });

            if (ch.type === "sms") {
              // Phase 11f — direct Twilio Messages.create + message_queue stamp.
              // System/probe clients (clients.is_system) write the message_queue row
              // the canary verifies but skip the real Twilio dispatch (verify-only).
              const isSystemClient = client.is_system === true;
              const twilioSid = client.twilio_account_sid as string | null;
              const twilioAuth = client.twilio_auth_token as string | null;
              const twilioFrom =
                (client.twilio_default_phone as string | null) ??
                (client.retell_phone_1 as string | null);
              const toNumber = payload.Phone;
              if (!isSystemClient && (!twilioSid || !twilioAuth || !twilioFrom)) {
                throw new Error("SMS requires twilio_account_sid + twilio_auth_token + (twilio_default_phone || retell_phone_1)");
              }
              if (!toNumber) {
                throw new Error(`engage SMS in node ${node.id} has no phone number on the lead`);
              }
              const sendResult = await sendTwilioSmsAndStamp({
                supabase,
                twilioSid: twilioSid ?? "",
                twilioAuth: twilioAuth ?? "",
                fromNumber: twilioFrom ?? "",
                toNumber,
                body: message,
                clientId: client_id,
                leadId: lead_id,
                ghlAccountId: ghl_account_id,
                contactName: contact_name ?? null,
                contactEmail: payload.Email ?? null,
                ghlApiKey: (client.ghl_api_key as string | null) ?? null,
                ghlLocationId: (client.ghl_location_id as string | null) ?? null,
                ghlContactId: lead_id,
                ghlConversationProviderId:
                  (client.ghl_conversation_provider_id as string | null) ?? null,
                skipDispatch: isSystemClient,
              });
              if (!sendResult.ok) {
                throw new Error(
                  `Twilio SMS failed: ${sendResult.errorCode ?? "?"} ${sendResult.errorMessage ?? "unknown"}`,
                );
              }
              console.log(`Engage SMS sent to lead ${lead_id}: ${redactBody(message)} (sid=${sendResult.sid})`);
              metricsBuffer.sms_sent++;
              // REL-04 — the spend already happened; a failed post-send write
              // must not throw the task into a retry that replays the node.
              try {
                await updateExecution({
                  last_sms_sent_at: new Date().toISOString(),
                  stage_description: "SMS sent.",
                });
                await Promise.all([
                  logCampaignEvent({
                    event_type: "message_sent",
                    channel: "sms",
                    node_index: i,
                    node_id: node.id,
                    metadata: { message_body: message, twilio_message_sid: sendResult.sid },
                  }),
                  writeToChatHistory(message),
                ]);
              } catch (postErr) {
                console.warn(`Engage SMS post-send writes failed (non-fatal): ${(postErr as Error).message}`);
              }
            } else if (ch.type === "whatsapp") {
              if (!client.send_engagement_webhook_url) {
                throw new Error("WhatsApp requires client.send_engagement_webhook_url");
              }
              const waType = ch.whatsapp_type ?? "text";
              const webhookPayload: Record<string, unknown> = {
                Lead_ID: lead_id,
                Message: message,
                Channel: "WhatsApp",
                Setter_Number: String(textSetterNumber),
                Type: waType === "template" ? "Template" : "Text",
              };
              if (waType === "template" && ch.template_name) {
                webhookPayload.Template_Name = ch.template_name;
              }
              const resp = await fetch(client.send_engagement_webhook_url as string, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(webhookPayload),
              });
              if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`Engagement webhook (whatsapp) failed ${resp.status}: ${errText.slice(0, 200)}`);
              }
              console.log(`Engage whatsapp sent to lead ${lead_id}: ${redactBody(message)}`);
              metricsBuffer.whatsapp_sent++;
              const isWaTemplate = waType === "template" && !!ch.template_name;
              const eventMessageBody = isWaTemplate
                ? `WhatsApp Template from GoHighLevel:\n\n"${ch.template_name}"`
                : message;
              // REL-04 — post-send writes are non-fatal after the spend.
              try {
                await updateExecution({ stage_description: "WhatsApp sent." });
                await Promise.all([
                  logCampaignEvent({
                    event_type: "message_sent",
                    channel: "whatsapp",
                    node_index: i,
                    node_id: node.id,
                    metadata: { message_body: eventMessageBody },
                  }),
                  writeToChatHistory(message),
                ]);
              } catch (postErr) {
                console.warn(`Engage WhatsApp post-send writes failed (non-fatal): ${(postErr as Error).message}`);
              }
            } else if (ch.type === "email") {
              // Cadence v2 — email via GHL Conversations API. Send + log
              // happen in one call when the location has email infra
              // configured; falls back to a Notes write if not.
              const ghlApiKey = client.ghl_api_key as string | null;
              const ghlLocationId = client.ghl_location_id as string | null;
              if (!ghlApiKey || !ghlLocationId) {
                throw new Error("email channel requires client.ghl_api_key + ghl_location_id");
              }
              const subject = (aiSubject ?? interpolate(ch.subject || "")).trim();
              if (!subject) {
                throw new Error(`email channel in node ${node.id} is missing a subject`);
              }
              const bodyFormat = ch.body_format ?? "html";
              const emailResult = await pushEmailToGhl({
                ghlApiKey,
                ghlLocationId,
                contactId: lead_id,
                subject,
                body: message,
                bodyFormat,
                fromEmail: ch.from_email,
                toEmail: payload.Email,
                altId: null,
              });
              if (!emailResult.ok && emailResult.via === "conversations") {
                // Conversations send failed even after the fallback — surface
                // so the run can be retried or human-investigated.
                throw new Error(
                  `Email send failed: ${emailResult.status ?? "?"} ${emailResult.error ?? "unknown"}`,
                );
              }
              console.log(
                `Engage email sent to lead ${lead_id} via ${emailResult.via} (subject="${subject.slice(0, 60)}", body=${redactBody(message)})`,
              );
              metricsBuffer.emails_sent++;
              // REL-04 — post-send writes are non-fatal after the spend.
              try {
                await updateExecution({ stage_description: emailResult.via === "conversations" ? "Email sent." : "Email logged to Notes (no email channel configured)." });
                await Promise.all([
                  logCampaignEvent({
                    event_type: "message_sent",
                    channel: "email",
                    node_index: i,
                    node_id: node.id,
                    metadata: { subject, body_preview: message.slice(0, 400), via: emailResult.via, ghl_message_id: emailResult.emailMessageId ?? null },
                  }),
                  writeToChatHistory(`[Email] ${subject}\n\n${message}`),
                ]);
              } catch (postErr) {
                console.warn(`Engage email post-send writes failed (non-fatal): ${(postErr as Error).message}`);
              }
            }
          }

        // ── SEND SMS node (legacy; phase-11f routed through direct Twilio) ──
        } else if (node.type === "send_sms") {
          await enforceQuietHoursBeforeSend(`send_sms node ${i}`);
          if (await isCancelled()) { await writeCadenceMetrics("cancelled"); return { status: "cancelled", node_index: i }; }
          const message = interpolate(node.message);
          await updateExecution({ stage_description: "Sending SMS..." });

          // CAD-01 — on a retry that replays this node, skip the re-send if a
          // prior attempt already delivered it (campaign_events marker).
          if (((await getSentChannelCounts(i)).get("sms") ?? 0) > 0) {
            console.log(`send_sms node ${i}: already sent in a prior attempt — skipping re-send (CAD-01 marker)`);
          } else {
            const twilioSid = client.twilio_account_sid as string | null;
            const twilioAuth = client.twilio_auth_token as string | null;
            const twilioFrom =
              (client.twilio_default_phone as string | null) ??
              (client.retell_phone_1 as string | null);
            const toNumber = payload.Phone;
            if (!twilioSid || !twilioAuth || !twilioFrom) {
              throw new Error("send_sms requires twilio_account_sid + twilio_auth_token + (twilio_default_phone || retell_phone_1)");
            }
            if (!toNumber) {
              throw new Error(`send_sms node ${node.id} has no phone number on the lead`);
            }
            const sendResult = await sendTwilioSmsAndStamp({
              supabase,
              twilioSid,
              twilioAuth,
              fromNumber: twilioFrom,
              toNumber,
              body: message,
              clientId: client_id,
              leadId: lead_id,
              ghlAccountId: ghl_account_id,
              contactName: contact_name ?? null,
              contactEmail: payload.Email ?? null,
              ghlApiKey: (client.ghl_api_key as string | null) ?? null,
              ghlLocationId: (client.ghl_location_id as string | null) ?? null,
              ghlContactId: lead_id,
              ghlConversationProviderId:
                (client.ghl_conversation_provider_id as string | null) ?? null,
            });
            if (!sendResult.ok) {
              throw new Error(
                `Twilio SMS failed: ${sendResult.errorCode ?? "?"} ${sendResult.errorMessage ?? "unknown"}`,
              );
            }

            console.log(`SMS sent to lead ${lead_id}: ${redactBody(message)} (sid=${sendResult.sid})`);
            metricsBuffer.sms_sent++;
            // REL-04 — post-send writes are non-fatal after the spend.
            try {
              await updateExecution({
                last_sms_sent_at: new Date().toISOString(),
                stage_description: "SMS sent.",
              });
              await Promise.all([
                logCampaignEvent({ event_type: "message_sent", channel: "sms", node_index: i, node_id: node.id, metadata: { message_body: message, twilio_message_sid: sendResult.sid } }),
                writeToChatHistory(message),
              ]);
            } catch (postErr) {
              console.warn(`send_sms post-send writes failed (non-fatal): ${(postErr as Error).message}`);
            }
          }

        // ── SEND WHATSAPP node ──────────────────────────────────────────────
        } else if (node.type === "send_whatsapp") {
          await enforceQuietHoursBeforeSend(`send_whatsapp node ${i}`);
          if (await isCancelled()) { await writeCadenceMetrics("cancelled"); return { status: "cancelled", node_index: i }; }
          const message = interpolate(node.message);
          await updateExecution({ stage_description: "Sending WhatsApp..." });

          // CAD-01 — on a retry that replays this node, skip the re-send if a
          // prior attempt already delivered it (campaign_events marker).
          if (((await getSentChannelCounts(i)).get("whatsapp") ?? 0) > 0) {
            console.log(`send_whatsapp node ${i}: already sent in a prior attempt — skipping re-send (CAD-01 marker)`);
          } else {
            const waResponse = await fetch(client.send_engagement_webhook_url as string, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                Lead_ID: lead_id,
                Message: message,
                Channel: "WhatsApp",
                Setter_Number: String(textSetterNumber),
              }),
            });

            if (!waResponse.ok) {
              const errText = await waResponse.text();
              throw new Error(`Engagement webhook (WhatsApp) failed ${waResponse.status}: ${errText.slice(0, 200)}`);
            }

            console.log(`WhatsApp sent to lead ${lead_id}: ${redactBody(message)}`);
            metricsBuffer.whatsapp_sent++;
            // REL-04 — post-send writes are non-fatal after the spend.
            try {
              await updateExecution({ stage_description: "WhatsApp sent." });
              await Promise.all([
                logCampaignEvent({ event_type: "message_sent", channel: "whatsapp", node_index: i, node_id: node.id, metadata: { message_body: message } }),
                writeToChatHistory(message),
              ]);
            } catch (postErr) {
              console.warn(`send_whatsapp post-send writes failed (non-fatal): ${(postErr as Error).message}`);
            }
          }

        // ── PHONE CALL node (legacy flat) ───────────────────────────────────
        } else if (node.type === "phone_call") {
          await enforceQuietHoursBeforeSend(`phone_call node ${i}`);
          if (await isCancelled()) { await writeCadenceMetrics("cancelled"); return { status: "cancelled", node_index: i }; }
          if (!payload.make_retell_call_url) {
            throw new Error("phone_call node requires make_retell_call_url in payload");
          }
          const legacyVoiceSetter = (node as unknown as { voice_setter_id?: string }).voice_setter_id;
          const legacyTreatPickupAsReply = (node as unknown as { treat_pickup_as_reply?: boolean }).treat_pickup_as_reply;
          if (!legacyVoiceSetter) {
            throw new Error(`phone_call node ${node.id} is missing voice_setter_id`);
          }
          // DEPRECATED (2026-05-31): same retired persona-slot override as the
          // engage-node phone_call branch. Inert (nothing sets the field now);
          // falls through to the node's voice_setter_id. Removable next deploy.
          const legacyOverrideVoiceSetterId =
            (payload.contact_fields as Record<string, string> | undefined)?.voice_setter_id_override;
          const effectiveLegacyVoiceSetter = legacyOverrideVoiceSetterId || legacyVoiceSetter;
          await updateExecution({ stage_description: "Queued for outbound call..." });
          const legacyCallRun = await placeOutboundCall.triggerAndWait({
            make_retell_call_url: payload.make_retell_call_url,
            client_id,
            voice_setter_id: effectiveLegacyVoiceSetter,
            ghl_contact_id: lead_id,
            ghl_account_id,
            execution_id,
            // CAD-02 — dedup key (single channel per legacy node, so ci=0).
            idempotency_key: `${execution_id}:${i}:0`,
            custom_instructions: interpolate(node.instructions || ""),
            contact_fields: payload.contact_fields || {},
            treat_pickup_as_reply: legacyTreatPickupAsReply ?? false,
          }, {
            // CAD-02 — parent retries re-attach to the same child run.
            idempotencyKey: `place:${execution_id}:${i}:0`,
          });
          if (legacyCallRun.ok !== true) {
            const legacyFailure = legacyCallRun as { error?: unknown };
            throw new Error(`place-outbound-call failed: ${String(legacyFailure.error ?? "unknown")}`);
          }
          const legacyCallId = legacyCallRun.output?.call_id;
          const legacyCallWasDeduped = legacyCallRun.output?.already_placed === true;
          console.log(
            `Phone call ${legacyCallWasDeduped ? "replayed (deduped, no new dial)" : "placed"} for ${lead_id}: call_id=${legacyCallId}`
          );
          if (!legacyCallWasDeduped) {
            // Cadence v2 — bump leads.last_outbound_at for cold-reply nudge accounting.
            try {
              await supabase
                .from("leads")
                .update({ last_outbound_at: new Date().toISOString() })
                .eq("client_id", client_id)
                .eq("lead_id", lead_id);
            } catch (tsErr) {
              console.warn("runEngagement: last_outbound_at bump (legacy call) failed (non-fatal)", tsErr);
            }
            metricsBuffer.calls_attempted++;
            await logCampaignEvent({
              event_type: "message_sent",
              channel: "phone_call",
              node_index: i,
              node_id: node.id,
              metadata: { call_id: legacyCallId, voice_setter_id: effectiveLegacyVoiceSetter },
            });
          }

          // Bug 1 — wait for call_ended before advancing.
          if (legacyCallId) {
            await updateExecution({ stage_description: "Call in progress — awaiting outcome...", active_call_id: legacyCallId });
            const legacyWaitResult = await waitForCallOutcome({
              supabase,
              executionId: execution_id,
              callId: legacyCallId,
              isCancelled,
              pollIntervalSeconds: 5,
            });
            if (legacyWaitResult === "cancelled") {
              console.log(`Engagement ${execution_id} cancelled during legacy phone_call wait`);
              await writeCadenceMetrics("cancelled");
              return { status: "cancelled", node_index: i };
            }
            if (legacyWaitResult === null) {
              console.warn(
                `Engagement ${execution_id}: legacy call ${legacyCallId} outcome timed out — assuming missed`
              );
            }
            const legacyOutcomeClass = classifyCallOutcome(legacyWaitResult);
            console.log(
              `Engagement ${execution_id}: legacy call ${legacyCallId} outcome=${legacyOutcomeClass} ` +
              `(disconnect=${legacyWaitResult?.disconnect_reason ?? "?"}, status=${legacyWaitResult?.call_status ?? "?"})`
            );
            if (legacyOutcomeClass === "human_pickup") {
              metricsBuffer.calls_picked_up++;
              if (legacyTreatPickupAsReply) {
                await updateExecution({
                  status: "completed",
                  stop_reason: "call_engaged",
                  stage_description: "Call answered by human — engagement complete.",
                  completed_at: new Date().toISOString(),
                  last_completed_node_index: i,
                  active_call_id: null,
                });
                await writeCadenceMetrics("call_engaged");
                return { status: "completed", stop_reason: "call_engaged" };
              }
            }
          }

          // Clear the voice-call hold whenever we stop waiting on the call
          // (deduped replays re-arm it after the webhook's clear; the timeout
          // path never cleared it). Idempotent with the webhook's clear.
          await updateExecution({ stage_description: "Phone call ended.", active_call_id: null });

        // ── WAIT FOR REPLY node ─────────────────────────────────────────────
        } else if (node.type === "wait_for_reply") {
          const waitStartedAt = new Date();
          const resumeAt = new Date(Date.now() + node.timeout_seconds * 1000);

          await updateExecution({
            stage_description: `Waiting up to ${formatDuration(node.timeout_seconds)} for reply...`,
            waiting_for_reply_since: waitStartedAt.toISOString(),
            waiting_for_reply_until: resumeAt.toISOString(),
          });

          await wait.until({ date: resumeAt });

          // Check message_queue for any INBOUND message since we sent the SMS.
          // Exclude our own outbound stamps (channel 'sms_outbound', written by
          // the send paths) — without this filter the node's own outbound row,
          // created right around waitStartedAt, can be misread as a lead reply.
          const { data: replies } = await supabase
            .from("message_queue")
            .select("id")
            .eq("lead_id", lead_id)
            .eq("ghl_account_id", ghl_account_id)
            .gte("created_at", waitStartedAt.toISOString())
            .or("channel.is.null,channel.neq.sms_outbound")
            .limit(1);

          await updateExecution({
            waiting_for_reply_since: null,
            waiting_for_reply_until: null,
          });

          if (replies && replies.length > 0) {
            console.log(`Lead ${lead_id} replied — stopping engagement`);
            metricsBuffer.reply_received = true;
            metricsBuffer.time_to_first_response_seconds = Math.max(
              0,
              Math.round((Date.now() - runStartedAt) / 1000),
            );
            await updateExecution({
              status: "completed",
              stop_reason: "inbound_reply",
              stage_description: "Lead replied — engagement complete.",
              completed_at: new Date().toISOString(),
              last_completed_node_index: i,
            });
            await writeCadenceMetrics("inbound_reply");
            return { status: "completed", stop_reason: "inbound_reply" };
          }

          console.log(`No reply from ${lead_id} — continuing sequence`);
        }

        // Mark this node as fully completed so retries can resume here instead
        // of replaying it from the beginning. Written after every node type.
        await updateExecution({ last_completed_node_index: i });
        metricsBuffer.nodes_fired++;
      }

      // All nodes completed without a reply
      await logCampaignEvent({
        event_type: "completed",
        node_index: nodes.length - 1,
        metadata: { stop_reason: "sequence_complete", total_nodes: nodes.length },
      });
      await updateExecution({
        status: "completed",
        stop_reason: "sequence_complete",
        stage_description: "Engagement sequence finished.",
        completed_at: new Date().toISOString(),
        // B7: clear any dangling call hold. Every other terminal/branch exit nulls
        // active_call_id; the sequence_complete path was the one that omitted it.
        active_call_id: null,
      });

      await writeCadenceMetrics("sequence_complete");
      return { status: "completed", stop_reason: "sequence_complete" };

    } catch (error) {
      await updateExecution({
        status: "failed",
        stage_description: `Error: ${(error as Error).message}`,
        completed_at: new Date().toISOString(),
        waiting_for_reply_since: null,
        waiting_for_reply_until: null,
      });
      await writeCadenceMetrics("error");
      throw error;
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

// ── Schedule types & helpers ──────────────────────────────────────────────────

type ScheduleConfig = {
  timezone: string;   // IANA name, e.g. "America/New_York"
  days: number[];     // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start_time: string; // "09:00" 24h, in the configured timezone
  end_time: string;   // "17:00" 24h, in the configured timezone
};

// Converts a local calendar date + time to a UTC Date for a given IANA timezone.
// Uses a correction loop: start with the time treated as UTC, check what local
// time that maps to in the target TZ, then shift by the difference.
function localToUTC(dateStr: string, timeStr: string, tz: string): Date {
  const utcGuess = new Date(`${dateStr}T${timeStr}:00Z`);
  const actualLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).format(utcGuess);
  // en-CA format: "2024-04-12, 05:00" — replace ", " with "T" and append "Z" for UTC math
  const actualLocalMs = new Date(actualLocal.replace(", ", "T") + ":00Z").getTime();
  const targetMs = new Date(`${dateStr}T${timeStr}:00Z`).getTime();
  return new Date(utcGuess.getTime() + (targetMs - actualLocalMs));
}

// Returns the UTC Date for the end of the schedule window on the same day as 'now',
// or null if 'now' is not currently inside a schedule window.
function getScheduleWindowEnd(now: Date, schedule: ScheduleConfig): Date | null {
  const [sh, sm] = schedule.start_time.split(":").map(Number);
  const [eh, em] = schedule.end_time.split(":").map(Number);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dayMap[p.weekday];
  if (dow === undefined || !schedule.days.includes(dow)) return null;

  const localH = parseInt(p.hour) === 24 ? 0 : parseInt(p.hour);
  const curMin = localH * 60 + parseInt(p.minute);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (curMin < startMin || curMin >= endMin) return null; // outside this day's window

  return localToUTC(`${p.year}-${p.month}-${p.day}`, schedule.end_time, schedule.timezone);
}

// Calculate when batch N fires, counting intervals only during schedule working hours.
// Example: interval=1h, window=9am-5pm. Batch 0=9am, batch 7=4pm, batch 8=9am next day.
// This prevents off-hours batches from bunching up at the next window opening.
function getScheduleAwareBatchTime(
  batchNumber: number,
  campaignStartedAt: Date,
  intervalSeconds: number,
  schedule: ScheduleConfig
): Date {
  // Snap start to the first schedule window opening (or keep if already inside)
  let current = getNextScheduleWindow(campaignStartedAt, schedule) ?? campaignStartedAt;

  let remaining = batchNumber * intervalSeconds;

  while (remaining > 0) {
    const windowEnd = getScheduleWindowEnd(current, schedule);

    if (!windowEnd) {
      // current is outside the window — snap forward to next opening
      const next = getNextScheduleWindow(current, schedule);
      if (!next) break; // no valid window found (misconfigured schedule)
      current = next;
      continue;
    }

    const windowSecondsLeft = (windowEnd.getTime() - current.getTime()) / 1000;

    if (remaining <= windowSecondsLeft) {
      // Fits within this window
      current = new Date(current.getTime() + remaining * 1000);
      remaining = 0;
    } else {
      // Consume the rest of this window, jump to the next one
      remaining -= windowSecondsLeft;
      const next = getNextScheduleWindow(new Date(windowEnd.getTime() + 60_000), schedule);
      if (!next) { current = windowEnd; break; }
      current = next;
    }
  }

  return current;
}

// Returns null if currently inside the schedule window (proceed immediately),
// or the next Date (UTC) when the schedule window opens.
function getNextScheduleWindow(now: Date, schedule: ScheduleConfig): Date | null {
  const [sh, sm] = schedule.start_time.split(":").map(Number);
  const [eh, em] = schedule.end_time.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  for (let offset = 0; offset <= 7; offset++) {
    const probe = new Date(now.getTime() + offset * 86_400_000);

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timezone,
      weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    }).formatToParts(probe);

    const p: Record<string, string> = {};
    for (const x of parts) p[x.type] = x.value;

    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dow = dayMap[p.weekday];
    if (dow === undefined || !schedule.days.includes(dow)) continue;

    const localH = parseInt(p.hour) === 24 ? 0 : parseInt(p.hour);
    const curMin = localH * 60 + parseInt(p.minute);

    if (offset === 0) {
      if (curMin >= endMin) continue;      // past today's window — try tomorrow
      if (curMin >= startMin) return null;  // currently inside window — go now
    }

    // Compute UTC timestamp for start_time on this calendar day in the timezone
    const dateStr = `${p.year}-${p.month}-${p.day}`;
    return localToUTC(dateStr, schedule.start_time, schedule.timezone);
  }

  return null; // no window found — schedule.days is likely empty
}
