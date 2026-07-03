// SMS-MEM-1 — persist the inbound human turn to chat_history in the normal (non-stopped)
// SMS reply path. Before this, processSetterReply only ever wrote the AI turn, so every
// inbound had zero record of what the lead actually said — the model would re-ask
// already-answered questions and could not connect an accepted time to an earlier-stated
// day. Mirrors the existing setter_stopped-path human write in receive-twilio-sms/index.ts
// (same 4-key LangChain HumanMessage shape: type/content/additional_kwargs/response_metadata,
// no tool_calls/invalid_tool_calls — those are AI-only keys).

type MinimalSupabase = {
  from: (table: string) => { insert: (rows: unknown) => Promise<{ error: unknown }> };
};

export type PersistHumanTurnArgs = {
  supabase: MinimalSupabase;
  leadId: string;
  messageBody: string;
  timestamp: string;
};

export async function persistHumanTurn(
  args: PersistHumanTurnArgs
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, leadId, messageBody, timestamp } = args;
  try {
    const { error } = await supabase.from("chat_history").insert({
      session_id: leadId,
      message: {
        type: "human",
        content: messageBody,
        additional_kwargs: {},
        response_metadata: {},
      },
      timestamp,
    });
    if (error) {
      const message = (error as { message?: string })?.message ?? String(error);
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
