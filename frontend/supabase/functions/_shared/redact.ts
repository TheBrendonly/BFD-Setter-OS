// SEC-PII-LOGS-1 — shared log redaction helpers.
//
// Prospect PII (phone / email / DM content) must not be written unredacted to
// stdout, which flows to Supabase / Trigger / Railway platform logs. These keep
// just enough for correlation (last 4 of a phone, first char + domain of an
// email) without exposing the full identifier. Promoted from the inline
// redactPhone in retell-inbound-webhook so every function can reuse one copy.

/** "***1234" — keep the last 4 digits for matching, hide the rest. */
export function redactPhone(p: string | null | undefined): string {
  if (!p) return "<none>";
  const s = String(p);
  return s.length <= 4 ? "***" : "***" + s.slice(-4);
}

/** "j***@example.com" — hide the local part but the first char, keep the domain. */
export function redactEmail(e: string | null | undefined): string {
  if (!e) return "<none>";
  const s = String(e).trim();
  const at = s.indexOf("@");
  if (at <= 0) return "***"; // not an email shape
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  return `${local[0] ?? ""}***@${domain}`;
}

/** Safe one-line summary of a webhook body: top-level keys + a size, never values. */
export function redactBodyShape(body: unknown): string {
  if (!body || typeof body !== "object") return `<${typeof body}>`;
  try {
    const keys = Object.keys(body as Record<string, unknown>);
    return `{keys: ${keys.join(",")}} (${JSON.stringify(body).length} bytes)`;
  } catch {
    return "<unserializable>";
  }
}
