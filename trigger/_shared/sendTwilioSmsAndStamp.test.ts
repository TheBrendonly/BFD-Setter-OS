// Unit tests for the by-phone lead_optouts gate injected into sendTwilioSmsAndStamp.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/sendTwilioSmsAndStamp.test.ts
//
// Strategy: exercise the REAL sendTwilioSmsAndStamp function with a fake supabase
// and a stubbed globalThis.fetch. This proves the actual Twilio fetch is blocked
// (never called) when the number is opted out, and IS called when it is not. (The test has teeth:
// disabling the gate causes tests 1 and 4 to fail.)
import test from "node:test";
import { strict as assert } from "node:assert";
import { sendTwilioSmsAndStamp } from "./sendTwilioSmsAndStamp.ts";

// ── Minimal supabase mock ──────────────────────────────────────────────────
// Mirrors the two queries sendTwilioSmsAndStamp needs:
//   1. isPhoneOptedOut: .from("lead_optouts").select("phone").eq(...).eq(...).maybeSingle()
//   2. post-send stamp:  .from("message_queue").insert(...)
//   3. post-send bump:   .from("leads").update(...).eq(...).eq(...)
function makeSupabase(optoutRow: { phone: string } | null) {
  const optoutChain: any = {
    select: () => optoutChain,
    eq: () => optoutChain,
    maybeSingle: async () => ({ data: optoutRow }),
  };
  const stampChain: any = {
    insert: async () => ({ error: null }),
    // BOOK-TZ/cost: the execution_cost_events best-effort write upserts; give the
    // fallthrough mock an upsert no-op so it resolves cleanly (was a harmless warn).
    upsert: async () => ({ error: null }),
  };
  const leadsChain: any = {
    update: () => leadsChain,
    eq: () => leadsChain,
    then: undefined, // not a promise; callers await the insert/update shape
  };
  // Return an update chain that resolves cleanly
  leadsChain.eq = () => ({ data: null, error: null });

  return {
    from: (table: string) => {
      if (table === "lead_optouts") return optoutChain;
      if (table === "message_queue") return stampChain;
      if (table === "leads") {
        return {
          update: () => ({
            eq: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return stampChain;
    },
  };
}

// Shared minimal args (all fields sendTwilioSmsAndStamp requires)
const BASE_ARGS = {
  twilioSid: "AC_fake_sid",
  twilioAuth: "fake_auth",
  fromNumber: "+61400000001",
  toNumber: "+61400000002",
  body: "Test message",
  clientId: "client-abc",
  leadId: "lead-xyz",
  ghlAccountId: "ghl-acct-1",
  contactName: "Test Lead",
  contactEmail: "test@example.com",
  ghlApiKey: null,
  ghlLocationId: null,
  ghlContactId: null,
  ghlConversationProviderId: null,
};

// ── Tests ──────────────────────────────────────────────────────────────────

test("opted-out number: Twilio fetch is NEVER called and result is no-send opted_out", async () => {
  // supabase returns an optout row: this number is blocked
  const supabase = makeSupabase({ phone: "+61400000002" });

  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (..._args: any[]) => {
    fetchCallCount++;
    // Should never reach here
    return new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 });
  };

  try {
    const result = await sendTwilioSmsAndStamp({ supabase, ...BASE_ARGS });

    assert.equal(fetchCallCount, 0, "fetch must NOT be called when number is opted out");
    assert.equal(result.ok, false, "result.ok must be false for opted-out number");
    assert.equal(result.sid, null, "result.sid must be null for opted-out number");
    assert.equal(result.errorMessage, "opted_out", "result.errorMessage must equal 'opted_out'");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-opted-out number: Twilio fetch IS called", async () => {
  // supabase returns null: no optout row, number is clear
  const supabase = makeSupabase(null);

  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string, _init: any) => {
    fetchCallCount++;
    // Return a minimal Twilio success shape
    return new Response(JSON.stringify({ sid: "SMfake123" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await sendTwilioSmsAndStamp({ supabase, ...BASE_ARGS });
    assert.ok(fetchCallCount > 0, "fetch must be called when number is NOT opted out");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unnormalisable toNumber: gate skips and Twilio fetch IS called (safe fall-through)", async () => {
  // Even with an optout row present, an unnormalisable number must not block
  const supabase = makeSupabase({ phone: "+61400000002" });

  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string, _init: any) => {
    fetchCallCount++;
    return new Response(JSON.stringify({ sid: "SMfake456" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await sendTwilioSmsAndStamp({ supabase, ...BASE_ARGS, toNumber: "123" });
    assert.ok(fetchCallCount > 0, "fetch must be called for unnormalisable phone (gate skips)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AU national format: normalised, matched in lead_optouts, Twilio fetch blocked", async () => {
  // normalizePhone("0400000002") -> "+61400000002"; row exists: blocked
  const supabase = makeSupabase({ phone: "+61400000002" });

  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (..._args: any[]) => {
    fetchCallCount++;
    return new Response(JSON.stringify({ sid: "SM_should_not_appear" }), { status: 201 });
  };

  try {
    const result = await sendTwilioSmsAndStamp({
      supabase,
      ...BASE_ARGS,
      toNumber: "0400000002",
    });

    assert.equal(fetchCallCount, 0, "fetch must NOT be called for AU national format opted-out number");
    assert.equal(result.ok, false, "result.ok must be false");
    assert.equal(result.errorMessage, "opted_out", "errorMessage must be opted_out");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
