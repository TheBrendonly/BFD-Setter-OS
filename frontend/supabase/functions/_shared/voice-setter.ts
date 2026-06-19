// Voice-setter row helpers for retell-proxy.
//
// delete-setter bug: the delete-voice-setter path deleted the Retell agent and
// cleared clients.[agentColumn] but left the voice_setters row pointing at the
// now-dead agent (an orphan, surfaced by the orphaned-setter badge). The delete
// path soft-deletes the row instead — symmetric with dualWriteVoiceSetter, which
// sets is_active:true on create.

export function buildVoiceSetterDeactivatePayload(): {
  is_active: false;
  retell_agent_id: null;
  retell_llm_id: null;
} {
  return { is_active: false, retell_agent_id: null, retell_llm_id: null };
}
