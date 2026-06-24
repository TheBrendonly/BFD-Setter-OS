// B4 send-idempotency for Trigger.dev tasks.
//
// A retry (sendFollowup maxAttempts 2, processMessages maxAttempts 3) that fires
// AFTER a successful Twilio send but before the post-send bookkeeping would
// otherwise re-send the SMS. Claim the send up front: the unique send_key insert
// succeeds exactly once; a 23505 unique-violation means a prior attempt already
// sent it, so the caller skips the re-send. On a genuine send failure the caller
// releases the claim so a retry can re-attempt.
//
// Backed by outbound_send_claims (service-role only). Mirrors the
// processed_webhook_sids "insert up front, 23505 == already processed" pattern.

// Returns true when this caller has the claim and should send; false when a prior
// attempt already claimed (already sent) this send_key. Fails OPEN (returns true)
// on any non-conflict error so a transient claims-table problem can never drop a
// real customer message — dedup is a guard, not the delivery gate.
export async function claimSend(
  supabase: any,
  sendKey: string,
  task: string,
  leadId: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from("outbound_send_claims")
    .insert({ send_key: sendKey, task, lead_id: leadId });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false; // already sent
  console.warn("claimSend: insert failed (allowing send)", { sendKey, error });
  return true;
}

// Drop a claim after a failed send so a task retry can re-attempt that message.
export async function releaseSend(supabase: any, sendKey: string): Promise<void> {
  const { error } = await supabase
    .from("outbound_send_claims")
    .delete()
    .eq("send_key", sendKey);
  if (error) console.warn("releaseSend: delete failed", { sendKey, error });
}
