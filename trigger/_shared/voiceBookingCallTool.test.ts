// FOLLOWUP-PROMPT-1 review follow-up — unit tests for makeVoiceBookingCallTool.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/voiceBookingCallTool.test.ts
//
// The voice-booking-tools HTTP closure existed twice: processSetterReply's copy had
// an AbortController + 30s timeout, sendFollowup's fork silently dropped it, so a
// hung GHL/edge call could stall a followup run for undici's ~300s default. This is
// the single shared factory both paths use; the tests pin the live path's exact
// semantics (URL shape, auth header, envelope unwrap, error prefix) plus the timeout.
import test from "node:test";
import { strict as assert } from "node:assert";
import { makeVoiceBookingCallTool, DEFAULT_TOOL_TIMEOUT_MS } from "./voiceBookingCallTool.ts";

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => body,
  }) as unknown as Response;

test("default timeout is the live path's 30s", () => {
  assert.equal(DEFAULT_TOOL_TIMEOUT_MS, 30_000);
});

test("builds the tool URL, sends auth header, unwraps the result envelope", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const callTool = makeVoiceBookingCallTool({
    supabaseUrl: "https://proj.supabase.co",
    clientId: "client-1",
    intakeSecret: "sekrit",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({ ok: true, tool: "get-available-slots", result: { slots: [1] } });
    },
  });

  const result = await callTool("get-available-slots", { startDate: 1 });
  assert.deepEqual(result, { slots: [1] });
  assert.equal(
    capturedUrl,
    "https://proj.supabase.co/functions/v1/voice-booking-tools?tool=get-available-slots&clientId=client-1"
  );
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer sekrit");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, JSON.stringify({ startDate: 1 }));
});

test("omits the auth header when there is no intake secret", async () => {
  let capturedInit: RequestInit | undefined;
  const callTool = makeVoiceBookingCallTool({
    supabaseUrl: "https://proj.supabase.co",
    clientId: "client-1",
    intakeSecret: null,
    fetchImpl: async (_url, init) => {
      capturedInit = init;
      return jsonResponse({ ok: true, result: null });
    },
  });
  await callTool("get-available-slots", {});
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, undefined);
});

test("non-ok response throws with the live path's error prefix", async () => {
  const callTool = makeVoiceBookingCallTool({
    supabaseUrl: "https://proj.supabase.co",
    clientId: "c",
    fetchImpl: async () => jsonResponse({ ok: false, error: "boom" }, false, 500),
  });
  await assert.rejects(
    () => callTool("book-appointments", {}),
    /voice-booking-tools book-appointments failed: boom/
  );
});

test("json.ok === false throws even on HTTP 200", async () => {
  const callTool = makeVoiceBookingCallTool({
    supabaseUrl: "https://proj.supabase.co",
    clientId: "c",
    fetchImpl: async () => jsonResponse({ ok: false, error: "slot taken" }),
  });
  await assert.rejects(() => callTool("book-appointments", {}), /slot taken/);
});

test("aborts a hung call after timeoutMs", async () => {
  const callTool = makeVoiceBookingCallTool({
    supabaseUrl: "https://proj.supabase.co",
    clientId: "c",
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          (err as Error & { name: string }).name = "AbortError";
          reject(err);
        });
      }),
  });
  await assert.rejects(() => callTool("get-available-slots", {}), /abort/i);
});
