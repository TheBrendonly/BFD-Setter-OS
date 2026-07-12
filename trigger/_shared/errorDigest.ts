// F23 — pure rollup for the proactive error_logs failure digest. Kept DB/HTTP-free so
// the grouping is unit-testable; the scheduled task (trigger/errorDigest.ts) does the
// query + Slack/email delivery.

export type ErrorRow = {
  client_id?: string | null;
  client_ghl_account_id?: string | null;
  source?: string | null;
};

export type ClientRollup = {
  clientKey: string; // client_id (uuid) when present, else client_ghl_account_id, else "unknown"
  count: number;
  sources: Record<string, number>; // source -> count, e.g. { "make-retell-outbound-call": 3 }
};

/** Roll a flat set of error_logs rows up per client, then per source, count-desc. */
export function rollupErrors(rows: ErrorRow[]): { total: number; clients: ClientRollup[] } {
  const byClient = new Map<string, { count: number; sources: Map<string, number> }>();
  for (const r of rows) {
    const cid = r.client_id || r.client_ghl_account_id || "unknown";
    const src = r.source || "unknown";
    const c = byClient.get(cid) ?? { count: 0, sources: new Map<string, number>() };
    c.count++;
    c.sources.set(src, (c.sources.get(src) ?? 0) + 1);
    byClient.set(cid, c);
  }
  const clients = [...byClient.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([clientKey, info]) => ({
      clientKey,
      count: info.count,
      sources: Object.fromEntries([...info.sources.entries()].sort((a, b) => b[1] - a[1])),
    }));
  return { total: rows.length, clients };
}

/** "Acme: 5 error(s) — make-retell-outbound-call×3, receive-twilio-sms×2" */
export function formatDigestLine(clientLabel: string, r: ClientRollup): string {
  const srcSummary = Object.entries(r.sources).map(([s, n]) => `${s}×${n}`).join(", ");
  return `${clientLabel}: ${r.count} error(s) — ${srcSummary}`;
}
