// Shared webhook authentication helpers.
//
// verifyRetellSignature — the CORRECT Retell scheme (2026). Retell sends:
//   X-Retell-Signature: v={unix_timestamp},d={hex_digest}
// where hex_digest = HMAC_SHA256(rawBody + timestamp, <RETELL_API_KEY>), and the
// timestamp must be within a 5-minute window (replay protection). The stored
// secret value MUST therefore be the Retell API key (org webhook key), NOT a
// separate webhook secret.
//
// The OLD per-function implementation computed HMAC(body, secret), stripped a
// non-existent "sha256=" prefix, and length/timing-compared the digest against
// the literal "v=...,d=..." header string -> it returned false for every real
// Retell webhook. Storing the secret would therefore 403 ALL Retell webhooks
// (call events, post-call analysis/booking, and the phone-first inbound lookup).
// This module replaces that. It is byte-shared by retell-call-webhook,
// retell-call-analysis-webhook and retell-inbound-webhook.
//
// Verify-if-present: callers only invoke this once the resolved client has the
// secret set; otherwise they accept (status quo, forgeable). Arm with a
// controlled live test call and revert the column to NULL on any 403.

const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Constant-time string compare (length-independent short-circuit on length only,
// which is not secret here — the digest length is fixed).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!signatureHeader) return false;

  // Parse `v={ts},d={hex}` — order-independent, tolerant of surrounding spaces.
  let ts: string | null = null;
  let digest: string | null = null;
  for (const part of signatureHeader.split(",")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k === "v") ts = v;
    else if (k === "d") digest = v;
  }
  if (!ts || !digest) return false;

  // Replay window. Retell sends a unix timestamp; tolerate seconds or ms.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
  if (Math.abs(nowMs - tsMs) > FIVE_MINUTES_MS) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody + ts));
  const sigBytes = new Uint8Array(sigBuf);
  let hex = "";
  for (const b of sigBytes) hex += b.toString(16).padStart(2, "0");
  return timingSafeEqual(hex.toLowerCase(), digest.toLowerCase());
}

// Static custom-header token check (GHL x-wh-token style). Some providers
// (e.g. Unipile) do NOT HMAC-sign the body; instead the integrator configures a
// static custom header on the webhook. We constant-time compare the configured
// secret against that header value. Verify-if-present.
//
// NOTE (Unipile): confirm the exact header + value against the Unipile webhook
// config before arming the secret — Unipile's signing scheme is not documented
// as HMAC, so this assumes the static-header model. Until confirmed live, leave
// unipile_webhook_secret NULL (inert).
export function verifyStaticToken(
  headerValue: string | null,
  secret: string,
): boolean {
  if (!headerValue) return false;
  return timingSafeEqual(headerValue, secret);
}
