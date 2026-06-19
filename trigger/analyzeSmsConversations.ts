// analyzeSmsConversations — 6.12b SMS path driver.
//
// Thin hourly scheduled task that invokes the analyze-sms-conversation edge
// function in scan mode. All logic (read SMS thread, LLM-classify, write GHL
// outcome fields, stamp the watermark) lives in the edge function so the SMS
// engine (processMessages / receive-twilio-sms) is never touched. This shim
// only triggers it on a schedule.

import { schedules } from "@trigger.dev/sdk";

export const analyzeSmsConversations = schedules.task({
  id: "analyze-sms-conversations",
  // Hourly. The edge function debounces (only settled threads with new activity
  // since last analysis) and is capped per run, so hourly is safe + cheap.
  cron: "0 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 1 },

  run: async () => {
    const baseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) {
      console.error("analyze-sms-conversations: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
      return { ok: false, reason: "missing_env" };
    }

    const resp = await fetch(`${baseUrl}/functions/v1/analyze-sms-conversation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}), // scan mode
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error(`analyze-sms-conversations: edge fn non-OK ${resp.status}: ${text.slice(0, 300)}`);
      return { ok: false, status: resp.status };
    }
    console.log(`analyze-sms-conversations: ${text.slice(0, 300)}`);
    return { ok: true };
  },
});
