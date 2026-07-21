// Shared alert poster for PROBE_ALERT_WEBHOOK_URL (syntheticProbe / errorDigest /
// pollRetellDrift). Trigger.dev tasks run in the CLOUD, so the sink must be a
// PUBLIC endpoint (a Tailscale-only host like greenserver is unreachable).
//
// Two shapes, auto-detected from the URL host:
//   - Telegram Bot API (api.telegram.org): posts {chat_id, message_thread_id?, text}.
//     chat_id (and optional message_thread_id for a forum topic) are read from the
//     URL query string, so ALL config lives in the one env var, e.g.
//     https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<id>&message_thread_id=<id>
//   - Anything else (Slack/Discord incoming webhook): posts {text, attachments},
//     the historical shape.
//
// Fire-and-forget: never throws; returns whether the POST was accepted.
export async function postAlert(title: string, detail?: string): Promise<boolean> {
  const url = process.env.PROBE_ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "api.telegram.org") {
      const chatId = parsed.searchParams.get("chat_id");
      const threadId = parsed.searchParams.get("message_thread_id");
      const text = (detail ? `${title}\n\n${detail}` : title).slice(0, 4000);
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      };
      if (threadId) body.message_thread_id = Number(threadId);
      const endpoint = `${parsed.origin}${parsed.pathname}`; // drop the query
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: title,
        attachments: detail ? [{ text: detail.slice(0, 2000) }] : undefined,
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn(`postAlert failed: ${(e as Error).message}`);
    return false;
  }
}
