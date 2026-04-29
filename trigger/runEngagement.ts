import { task, wait } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { placeOutboundCall } from "./placeOutboundCall";

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
  type: "sms" | "whatsapp" | "phone_call";
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
};

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

    // Check if execution was cancelled externally (Stop button)
    const isCancelled = async (): Promise<boolean> => {
      const { data } = await supabase
        .from("engagement_executions")
        .select("status")
        .eq("id", execution_id)
        .single();
      return !data || data.status === "cancelled" || data.status === "stopped" || data.status === "replied";
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

    try {
      // ── Load workflow ─────────────────────────────────────────────────────
      const { data: workflow } = await supabase
        .from("engagement_workflows")
        .select("nodes, name")
        .eq("id", workflow_id)
        .single();

      if (!workflow?.nodes) {
        throw new Error(`Engagement workflow ${workflow_id} not found or has no nodes`);
      }

      const nodes = workflow.nodes as EngagementNode[];
      // schedule column doesn't exist in DB yet — disabled until added
      const schedule = null as ScheduleConfig | null;

      // ── Load client config ────────────────────────────────────────────────
      const { data: client } = await supabase
        .from("clients")
        .select("send_engagement_webhook_url, supabase_url, supabase_service_key")
        .eq("id", client_id)
        .single();

      if (!client?.send_engagement_webhook_url) {
        throw new Error("Missing client send_engagement_webhook_url");
      }

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

        // Check for external cancellation before every node
        if (await isCancelled()) {
          console.log(`Engagement ${execution_id} cancelled at node ${i}`);
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
              if (await isCancelled()) return { status: "cancelled", node_index: i };
            }
          }

          const enabledChannels = node.channels.filter((ch) => ch.enabled);

          for (let ci = 0; ci < enabledChannels.length; ci++) {
            const ch = enabledChannels[ci];

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
              return { status: "cancelled", node_index: i };
            }

            if (ch.type === "phone_call") {
              if (!payload.make_retell_call_url) {
                throw new Error("phone_call channel requires make_retell_call_url in payload");
              }
              if (!ch.voice_setter_id) {
                throw new Error(`phone_call channel in node ${node.id} is missing voice_setter_id`);
              }
              await updateExecution({ stage_description: "Queued for outbound call..." });
              const callRun = await placeOutboundCall.triggerAndWait({
                make_retell_call_url: payload.make_retell_call_url,
                client_id,
                voice_setter_id: ch.voice_setter_id,
                ghl_contact_id: lead_id,
                ghl_account_id,
                execution_id,
                custom_instructions: interpolate(ch.instructions || ""),
                contact_fields: payload.contact_fields || {},
                treat_pickup_as_reply: ch.treat_pickup_as_reply ?? false,
              });
              if (callRun.ok !== true) {
                const failure = callRun as { error?: unknown };
                throw new Error(`place-outbound-call failed: ${String(failure.error ?? "unknown")}`);
              }
              const callId = callRun.output?.call_id;
              console.log(`Engage phone_call placed for ${lead_id}: call_id=${callId}`);
              await updateExecution({ stage_description: "Phone call placed." });
              await logCampaignEvent({
                event_type: "message_sent",
                channel: "phone_call",
                node_index: i,
                node_id: node.id,
                metadata: { call_id: callId, voice_setter_id: ch.voice_setter_id },
              });
              continue;
            }

            const message = interpolate(ch.message);
            await updateExecution({ stage_description: `Sending ${ch.type === "sms" ? "SMS" : "WhatsApp"}...` });

            const channelLabel = ch.type === "sms" ? "SMS" : "WhatsApp";

            // Build payload — WhatsApp adds Type and optionally Template_Number
            const webhookPayload: Record<string, unknown> = {
              Lead_ID: lead_id,
              Message: message,
              Channel: channelLabel,
              Setter_Number: String(textSetterNumber),
            };
            if (ch.type === "whatsapp") {
              const waType = ch.whatsapp_type ?? "text";
              webhookPayload.Type = waType === "template" ? "Template" : "Text";
              if (waType === "template" && ch.template_name) {
                webhookPayload.Template_Name = ch.template_name;
              }
            }

            const resp = await fetch(client.send_engagement_webhook_url as string, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(webhookPayload),
            });

            if (!resp.ok) {
              const errText = await resp.text();
              throw new Error(`Engagement webhook (${ch.type}) failed ${resp.status}: ${errText.slice(0, 200)}`);
            }

            console.log(`Engage ${ch.type} sent to lead ${lead_id}: ${redactBody(message)}`);
            await updateExecution({
              ...(ch.type === "sms" ? { last_sms_sent_at: new Date().toISOString() } : {}),
              stage_description: `${ch.type === "sms" ? "SMS" : "WhatsApp"} sent.`,
            });
            const isWaTemplate = ch.type === "whatsapp" && ch.whatsapp_type === "template" && !!ch.template_name;
            const eventMessageBody = isWaTemplate
              ? `WhatsApp Template from GoHighLevel:\n\n"${ch.template_name}"`
              : message;
            await Promise.all([
              logCampaignEvent({
                event_type: "message_sent",
                channel: ch.type,
                node_index: i,
                node_id: node.id,
                metadata: { message_body: eventMessageBody },
              }),
              writeToChatHistory(message),
            ]);
          }

        // ── SEND SMS node (legacy) ──────────────────────────────────────────
        } else if (node.type === "send_sms") {
          const message = interpolate(node.message);
          await updateExecution({ stage_description: "Sending SMS..." });

          const smsResponse = await fetch(client.send_engagement_webhook_url as string, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              Lead_ID: lead_id,
              Message: message,
              Channel: "SMS",
              Setter_Number: String(textSetterNumber),
            }),
          });

          if (!smsResponse.ok) {
            const errText = await smsResponse.text();
            throw new Error(`Engagement webhook (SMS) failed ${smsResponse.status}: ${errText.slice(0, 200)}`);
          }

          console.log(`SMS sent to lead ${lead_id}: ${redactBody(message)}`);
          await updateExecution({
            last_sms_sent_at: new Date().toISOString(),
            stage_description: "SMS sent.",
          });
          await Promise.all([
            logCampaignEvent({ event_type: "message_sent", channel: "sms", node_index: i, node_id: node.id, metadata: { message_body: message } }),
            writeToChatHistory(message),
          ]);

        // ── SEND WHATSAPP node ──────────────────────────────────────────────
        } else if (node.type === "send_whatsapp") {
          const message = interpolate(node.message);
          await updateExecution({ stage_description: "Sending WhatsApp..." });

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
          await updateExecution({ stage_description: "WhatsApp sent." });
          await Promise.all([
            logCampaignEvent({ event_type: "message_sent", channel: "whatsapp", node_index: i, node_id: node.id, metadata: { message_body: message } }),
            writeToChatHistory(message),
          ]);

        // ── PHONE CALL node (legacy flat) ───────────────────────────────────
        } else if (node.type === "phone_call") {
          if (!payload.make_retell_call_url) {
            throw new Error("phone_call node requires make_retell_call_url in payload");
          }
          const legacyVoiceSetter = (node as unknown as { voice_setter_id?: string }).voice_setter_id;
          const legacyTreatPickupAsReply = (node as unknown as { treat_pickup_as_reply?: boolean }).treat_pickup_as_reply;
          if (!legacyVoiceSetter) {
            throw new Error(`phone_call node ${node.id} is missing voice_setter_id`);
          }
          await updateExecution({ stage_description: "Queued for outbound call..." });
          const legacyCallRun = await placeOutboundCall.triggerAndWait({
            make_retell_call_url: payload.make_retell_call_url,
            client_id,
            voice_setter_id: legacyVoiceSetter,
            ghl_contact_id: lead_id,
            ghl_account_id,
            execution_id,
            custom_instructions: interpolate(node.instructions || ""),
            contact_fields: payload.contact_fields || {},
            treat_pickup_as_reply: legacyTreatPickupAsReply ?? false,
          });
          if (legacyCallRun.ok !== true) {
            const legacyFailure = legacyCallRun as { error?: unknown };
            throw new Error(`place-outbound-call failed: ${String(legacyFailure.error ?? "unknown")}`);
          }
          const legacyCallId = legacyCallRun.output?.call_id;
          console.log(`Phone call placed for ${lead_id}: call_id=${legacyCallId}`);
          await updateExecution({ stage_description: "Phone call placed." });
          await logCampaignEvent({
            event_type: "message_sent",
            channel: "phone_call",
            node_index: i,
            node_id: node.id,
            metadata: { call_id: legacyCallId, voice_setter_id: legacyVoiceSetter },
          });

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

          // Check message_queue for any inbound message since we sent the SMS
          const { data: replies } = await supabase
            .from("message_queue")
            .select("id")
            .eq("lead_id", lead_id)
            .eq("ghl_account_id", ghl_account_id)
            .gte("created_at", waitStartedAt.toISOString())
            .limit(1);

          await updateExecution({
            waiting_for_reply_since: null,
            waiting_for_reply_until: null,
          });

          if (replies && replies.length > 0) {
            console.log(`Lead ${lead_id} replied — stopping engagement`);
            await updateExecution({
              status: "completed",
              stop_reason: "replied",
              stage_description: "Lead replied — engagement complete.",
              completed_at: new Date().toISOString(),
              last_completed_node_index: i,
            });
            return { status: "completed", stop_reason: "replied" };
          }

          console.log(`No reply from ${lead_id} — continuing sequence`);
        }

        // Mark this node as fully completed so retries can resume here instead
        // of replaying it from the beginning. Written after every node type.
        await updateExecution({ last_completed_node_index: i });
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
      });

      return { status: "completed", stop_reason: "sequence_complete" };

    } catch (error) {
      await updateExecution({
        status: "failed",
        stage_description: `Error: ${(error as Error).message}`,
        completed_at: new Date().toISOString(),
        waiting_for_reply_since: null,
        waiting_for_reply_until: null,
      });
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
