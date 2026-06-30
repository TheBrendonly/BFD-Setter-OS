// VM-1 — unit tests for buildVoicemailPatch (extracted from retell-proxy set-voicemail).
//
// Run via: deno test --no-check frontend/supabase/functions/retell-proxy/voicemail.test.ts
//
// VM-1 root cause (read-only evidence): set-voicemail PATCHed enable_voicemail_detection +
// voicemail_detection_timeout_ms, but the live Retell agent schema no longer has those
// fields, so the whole PATCH 4xx'd and nothing landed ("Push partial"). The existing
// voicemail_option:{hangup} already lands via the same raw PATCH, so voicemail_option
// alone is the proven path. These tests lock that the built patch body contains ONLY
// voicemail_option (no deprecated detection fields) and maps each mode correctly.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVoicemailPatch } from "./voicemail.ts";

Deno.test("hangup mode -> voicemail_option only, NO deprecated detection fields", () => {
  const r = buildVoicemailPatch({ mode: "hangup" });
  assert(r.ok);
  assertEquals(r.patchBody.voicemail_option, { action: { type: "hangup" } });
  // The core VM-1 guarantee: the patch body never carries the rejected fields.
  assertEquals(Object.keys(r.patchBody), ["voicemail_option"]);
  assert(!("enable_voicemail_detection" in r.patchBody));
  assert(!("voicemail_detection_timeout_ms" in r.patchBody));
});

Deno.test("static mode with text -> static action", () => {
  const r = buildVoicemailPatch({ mode: "static", text: "Sorry we missed you" });
  assert(r.ok);
  assertEquals(r.patchBody.voicemail_option, { action: { type: "static", text: "Sorry we missed you" } });
  assertEquals(Object.keys(r.patchBody), ["voicemail_option"]);
});

Deno.test("prompt mode with text -> prompt action", () => {
  const r = buildVoicemailPatch({ mode: "prompt", text: "Leave a friendly message" });
  assert(r.ok);
  assertEquals(r.patchBody.voicemail_option, { action: { type: "prompt", text: "Leave a friendly message" } });
});

Deno.test("static / prompt without text -> skipped_missing_text", () => {
  const a = buildVoicemailPatch({ mode: "static", text: "  " });
  assert(!a.ok);
  assertEquals(a.action, "skipped_missing_text");
  const b = buildVoicemailPatch({ mode: "prompt", text: null });
  assert(!b.ok);
  assertEquals(b.action, "skipped_missing_text");
});

Deno.test("null config -> skipped_no_config; unknown mode -> invalid_mode", () => {
  const a = buildVoicemailPatch(null);
  assert(!a.ok);
  assertEquals(a.action, "skipped_no_config");
  const b = buildVoicemailPatch({ mode: "beep" });
  assert(!b.ok);
  assertEquals(b.action, "invalid_mode");
});
