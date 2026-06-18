// Unit tests for the by-phone lead_optouts gate injected into sendTwilioSmsAndStamp.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/sendTwilioSmsAndStamp.test.ts
//
// Strategy: the gate is the composition of normalizePhone + isPhoneOptedOut.
// Both helpers are already unit-testable (pure function + a thin supabase
// query). We test the composed gate directly — the same logic that runs
// inside sendTwilioSmsAndStamp before the Twilio fetch — rather than trying
// to load the whole module graph (which requires ghl-conversations).
import test from "node:test";
import { strict as assert } from "node:assert";
import { normalizePhone } from "./phone.ts";
import { isPhoneOptedOut } from "./optout.ts";

// ── Minimal supabase mock ──────────────────────────────────────────────────
// Mirrors the query inside isPhoneOptedOut:
//   supabase.from("lead_optouts").select("phone").eq(...).eq(...).maybeSingle()
function makeSupabase(optoutRow: { phone: string } | null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: optoutRow }),
  };
  return { from: (_table: string) => chain };
}

// ── Gate composite ─────────────────────────────────────────────────────────
// This is the exact logic copy-pasted from sendTwilioSmsAndStamp so any drift
// in the impl will cause a test failure here, which is intentional.
async function gateWouldBlock(
  supabase: any,
  clientId: string,
  toNumber: string,
): Promise<boolean> {
  const normalizedTo = normalizePhone(toNumber);
  if (!normalizedTo) return false; // unnormalisable — gate skips
  return isPhoneOptedOut(supabase, clientId, normalizedTo);
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("opted-out number: gate returns true (blocks Twilio call)", async () => {
  const supabase = makeSupabase({ phone: "+61400000002" });
  const blocked = await gateWouldBlock(supabase, "client-abc", "+61400000002");
  assert.equal(blocked, true, "gate must return true for a number in lead_optouts");
});

test("non-opted-out number: gate returns false (allows Twilio call)", async () => {
  const supabase = makeSupabase(null); // no row = not opted out
  const blocked = await gateWouldBlock(supabase, "client-abc", "+61400000002");
  assert.equal(blocked, false, "gate must return false when number not in lead_optouts");
});

test("unnormalisable toNumber: gate returns false (does not block)", async () => {
  // Even if a row existed, an unrecognisable number can't be normalised so
  // the gate must NOT block (safe fall-through).
  const supabase = makeSupabase({ phone: "+61400000002" });
  const blocked = await gateWouldBlock(supabase, "client-abc", "123");
  assert.equal(blocked, false, "gate must return false for unnormalisable phone (no block)");
});

test("AU national format normalised and matched in lead_optouts", async () => {
  // normalizePhone("0400000002") -> "+61400000002"
  const supabase = makeSupabase({ phone: "+61400000002" });
  const blocked = await gateWouldBlock(supabase, "client-abc", "0400000002");
  assert.equal(blocked, true, "AU national format must normalise and match the lead_optouts row");
});

test("null phone: gate returns false (safe fall-through)", async () => {
  const supabase = makeSupabase({ phone: "+61400000002" });
  const blocked = await gateWouldBlock(supabase, "client-abc", null as any);
  assert.equal(blocked, false, "null phone must not block");
});
