import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyRetellSignature } from "./verify-webhook.ts";

// BUG 6.6: arming retell_webhook_secret 403'd the inbound webhook (the agent
// then spoke literal {{first_name}}). This locks the signature scheme so the
// cause is unambiguous: Retell signs with x-retell-signature: v={ts},d={hex}
// where hex = HMAC_SHA256(rawBody + ts, <RETELL_API_KEY>). The stored secret
// MUST be the Retell API key. The live 403 was a wrong-value-armed mistake, not
// a code bug — see the missing-header + wrong-secret cases below.

const API_KEY = "key_retell_test_abc123";
const NOW_MS = 1_700_000_000_000; // fixed clock so the replay window is deterministic
const TS_SECONDS = "1700000000"; // 1.7e9 < 1e12 -> *1000 == NOW_MS (in window)
const RAW_BODY = JSON.stringify({
  event: "call_inbound",
  call_inbound: { agent_id: "agent_x", from_number: "+61400000000" },
});

async function signHex(body: string, ts: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body + ts));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("verifyRetellSignature: valid v=ts,d=hex signed with the API key -> true", async () => {
  const hex = await signHex(RAW_BODY, TS_SECONDS, API_KEY);
  const ok = await verifyRetellSignature(RAW_BODY, `v=${TS_SECONDS},d=${hex}`, API_KEY, NOW_MS);
  assertEquals(ok, true);
});

Deno.test("BUG 6.6 root cause: missing signature header -> false (so an armed secret 403s an UNSIGNED request)", async () => {
  const ok = await verifyRetellSignature(RAW_BODY, null, API_KEY, NOW_MS);
  assertEquals(ok, false);
});

Deno.test("verifyRetellSignature: wrong secret (not the Retell API key) -> false", async () => {
  // Signature is computed with the real API key, but a different value is armed.
  const hex = await signHex(RAW_BODY, TS_SECONDS, API_KEY);
  const ok = await verifyRetellSignature(RAW_BODY, `v=${TS_SECONDS},d=${hex}`, "some-other-secret", NOW_MS);
  assertEquals(ok, false);
});

Deno.test("verifyRetellSignature: tampered digest -> false", async () => {
  const ok = await verifyRetellSignature(RAW_BODY, `v=${TS_SECONDS},d=deadbeef`, API_KEY, NOW_MS);
  assertEquals(ok, false);
});

Deno.test("verifyRetellSignature: timestamp outside the 5-minute replay window -> false", async () => {
  const staleTs = "1699999000"; // ~16.6 min before NOW_MS
  const hex = await signHex(RAW_BODY, staleTs, API_KEY);
  const ok = await verifyRetellSignature(RAW_BODY, `v=${staleTs},d=${hex}`, API_KEY, NOW_MS);
  assertEquals(ok, false);
});

Deno.test("verifyRetellSignature: digest is compared case-insensitively -> true", async () => {
  const hex = await signHex(RAW_BODY, TS_SECONDS, API_KEY);
  const ok = await verifyRetellSignature(RAW_BODY, `v=${TS_SECONDS},d=${hex.toUpperCase()}`, API_KEY, NOW_MS);
  assertEquals(ok, true);
});

Deno.test("verifyRetellSignature: header parts are order-independent (d before v) -> true", async () => {
  const hex = await signHex(RAW_BODY, TS_SECONDS, API_KEY);
  const ok = await verifyRetellSignature(RAW_BODY, `d=${hex},v=${TS_SECONDS}`, API_KEY, NOW_MS);
  assertEquals(ok, true);
});

Deno.test("verifyRetellSignature: timestamp accepted in milliseconds form too -> true", async () => {
  const tsMs = "1700000000000"; // >= 1e12 -> used as ms directly == NOW_MS
  const hex = await signHex(RAW_BODY, tsMs, API_KEY);
  const ok = await verifyRetellSignature(RAW_BODY, `v=${tsMs},d=${hex}`, API_KEY, NOW_MS);
  assertEquals(ok, true);
});
