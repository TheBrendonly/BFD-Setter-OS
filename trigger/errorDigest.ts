// errorDigest (F23) — proactive failure digest over error_logs.
//
// error_logs is written from ~15 functions (booking 502s, outbound-call failures, SMS
// failures, webhook 403s) but is a passive table an agency opens by hand; only
// pollRetellDrift has an optional Slack push. A managed retainer's value is catching
// failures before the client does. This runs daily, rolls up the last 24h of error_logs
// per client + source, and pushes a digest to Slack now (PROBE_ALERT_WEBHOOK_URL) and,
// when RESEND_API_KEY is set, emails it (the same gate F15's weekly report uses). It
// NO-OPS on a clean day (zero new errors) to avoid alert fatigue.
//
// NOTE: like the other schedules.task crons in this repo (synthetic-probe /
// poll-retell-drift), if the declarative cron does not auto-register on deploy, register
// it imperatively via the Trigger schedules API (dedup key "error-digest-daily-prod").

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { rollupErrors, formatDigestLine } from "./_shared/errorDigest";

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function postSlack(text: string): Promise<boolean> {
  const url = process.env.PROBE_ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return true;
  } catch (e) {
    console.warn(`errorDigest: postSlack failed: ${(e as Error).message}`);
    return false;
  }
}

export const errorDigest = schedules.task({
  id: "error-digest",
  // Daily at 22:00 UTC (~8-9am AEST). Trigger.dev crons are UTC.
  cron: "0 22 * * *",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async () => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

    const { data: rows, error } = await supabase
      .from("error_logs")
      .select("client_id, client_ghl_account_id, source, error_type, severity, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      console.warn(`errorDigest: query failed: ${error.message}`);
      return { ok: false, error: error.message };
    }

    const { total, clients } = rollupErrors(rows ?? []);
    if (total === 0) {
      console.log("errorDigest: 0 errors in the last 24h — no digest sent.");
      return { ok: true, total: 0, sent: false };
    }

    // Resolve client names for readability (keys that are uuids).
    const uuidKeys = clients.map((c) => c.clientKey).filter((k) => /^[0-9a-f-]{36}$/i.test(k));
    const nameById = new Map<string, string>();
    if (uuidKeys.length) {
      const { data: clientRows } = await supabase.from("clients").select("id, name").in("id", uuidKeys);
      for (const c of clientRows ?? []) nameById.set(c.id as string, (c.name as string) ?? (c.id as string));
    }

    const lines = clients.map((c) => formatDigestLine(nameById.get(c.clientKey) ?? c.clientKey, c));
    const header = `⚠️ BFD failure digest (last 24h): ${total} error(s) across ${clients.length} client(s)`;
    const slackSent = await postSlack(`${header}\n${lines.map((l) => `• ${l}`).join("\n")}`);

    // Email leg — behind RESEND_API_KEY (same gate as the F15 weekly report).
    let emailSent = false;
    const resendKey = process.env.RESEND_API_KEY;
    const to = process.env.ERROR_DIGEST_RECIPIENT;
    if (resendKey && to) {
      try {
        const html =
          `<h3>${escapeHtml(header)}</h3><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Building Flow Digital <alerts@buildingflowdigital.com>",
            to,
            subject: `BFD failure digest — ${total} error(s) in 24h`,
            html,
          }),
        });
        emailSent = res.ok;
      } catch (e) {
        console.warn(`errorDigest: email failed: ${(e as Error).message}`);
      }
    }

    console.log(`errorDigest: ${total} errors across ${clients.length} clients; slack=${slackSent} email=${emailSent}`);
    return { ok: true, total, clients: clients.length, slackSent, emailSent };
  },
});
