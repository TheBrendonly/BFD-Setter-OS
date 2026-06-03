import { task, wait } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { placeOutboundCall } from "./placeOutboundCall";

// Fires a single "AI calls you back later" call at an absolute future time.
// The webhook (retell-call-analysis-webhook) inserts a scheduled_callbacks row
// when a lead asks to be called back (and didn't book), then triggers this task
// with the row id. We wait.until() the scheduled time (zero compute cost), then
// place one standalone outbound call from the same voice setter.
export const scheduleCallback = task({
  id: "schedule-callback",
  run: async (payload: { scheduled_callback_id: string }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: cb } = await supabase
      .from("scheduled_callbacks").select("*").eq("id", payload.scheduled_callback_id).maybeSingle();
    if (!cb || cb.status !== "pending") {
      return { skipped: true, reason: cb ? cb.status : "not_found" };
    }

    // Zero-cost wait until the scheduled instant.
    await wait.until({ date: new Date(cb.scheduled_for) });

    // Re-check status in case it was cancelled while we waited.
    const { data: fresh } = await supabase
      .from("scheduled_callbacks").select("status").eq("id", cb.id).maybeSingle();
    if (!fresh || fresh.status !== "pending") {
      return { skipped: true, reason: fresh ? fresh.status : "not_found" };
    }

    // Honor opt-out at fire time.
    const { data: lead } = await supabase
      .from("leads").select("setter_stopped")
      .eq("client_id", cb.client_id).eq("lead_id", cb.ghl_contact_id).maybeSingle();
    if (lead?.setter_stopped) {
      await supabase.from("scheduled_callbacks")
        .update({ status: "cancelled", callback_reason: "lead opted out", updated_at: new Date().toISOString() })
        .eq("id", cb.id);
      return { skipped: true, reason: "opted_out" };
    }

    const firstName = (cb.contact_name || "").split(" ")[0] || "";
    const handle = await placeOutboundCall.trigger({
      make_retell_call_url: `${process.env.SUPABASE_URL}/functions/v1/make-retell-outbound-call`,
      client_id: cb.client_id,
      voice_setter_id: cb.voice_setter_id,
      ghl_contact_id: cb.ghl_contact_id,
      ghl_account_id: cb.ghl_account_id || cb.client_id,
      // Standalone callback — not tied to a cadence execution. make-retell-outbound-call
      // logs against this id; the (non-existent) engagement_executions update no-ops.
      execution_id: cb.id,
      custom_instructions: cb.custom_instructions
        || `You are calling ${firstName || "the contact"} back as they asked earlier. Briefly re-introduce yourself, confirm it's a better time to talk, and pick up where you left off toward booking.`,
      contact_fields: { phone: cb.contact_phone || "", first_name: firstName },
      treat_pickup_as_reply: false,
    });

    await supabase.from("scheduled_callbacks")
      .update({ status: "placed", trigger_run_id: handle.id, updated_at: new Date().toISOString() })
      .eq("id", cb.id);

    return { placed: true, run_id: handle.id };
  },
});
