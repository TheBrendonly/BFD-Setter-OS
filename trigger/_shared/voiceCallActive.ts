// FOLLOWUP-DURING-CALL-1: a lead is "on a live voice call" when an
// engagement_executions row for that contact is still running with a non-null
// active_call_id (set by runEngagement when the call is placed, cleared by
// retell-call-webhook on call_ended). Mirrors the "Voice-call HOLD" query in
// processMessages.ts so sendFollowup and nudgeColdReply can suppress a
// setter-initiated SMS while the agent is talking to the lead right now.
//
// Scope with EITHER ghl_account_id (processMessages/sendFollowup) OR client_id
// (nudgeColdReply); pass whichever the caller has.
export async function isVoiceCallActive(
  supabase: any,
  args: { ghlContactId: string; ghlAccountId?: string | null; clientId?: string | null },
): Promise<boolean> {
  let query = supabase
    .from("engagement_executions")
    .select("id")
    .eq("ghl_contact_id", args.ghlContactId)
    .not("active_call_id", "is", null)
    .eq("status", "running")
    .limit(1);
  if (args.ghlAccountId) query = query.eq("ghl_account_id", args.ghlAccountId);
  if (args.clientId) query = query.eq("client_id", args.clientId);
  const { data } = await query.maybeSingle();
  return !!data;
}
