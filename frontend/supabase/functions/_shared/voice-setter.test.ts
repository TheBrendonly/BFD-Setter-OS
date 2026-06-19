import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVoiceSetterDeactivatePayload } from "./voice-setter.ts";

// delete-setter bug: deleting a voice setter removed the Retell agent + cleared
// the clients slot but LEFT the voice_setters row pointing at the dead agent.
// The delete path now soft-deletes that row (mirrors dualWriteVoiceSetter's
// is_active flag) so it can't linger as an orphan.

Deno.test("buildVoiceSetterDeactivatePayload soft-deletes + nulls the dead pointers", () => {
  const payload = buildVoiceSetterDeactivatePayload();
  assertEquals(payload, {
    is_active: false,
    retell_agent_id: null,
    retell_llm_id: null,
  });
});

Deno.test("buildVoiceSetterDeactivatePayload: is_active is false, not true (it's a delete)", () => {
  assertEquals(buildVoiceSetterDeactivatePayload().is_active, false);
});

Deno.test("buildVoiceSetterDeactivatePayload: no dangling agent/llm pointer survives", () => {
  const payload = buildVoiceSetterDeactivatePayload();
  assertEquals(payload.retell_agent_id, null);
  assertEquals(payload.retell_llm_id, null);
});
