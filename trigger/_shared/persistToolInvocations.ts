// SMS-OBS-1 — persist the SMS setter's tool calls/results for diagnosis.
//
// The text-engine tool loop (setterToolLoop.ts) records every tool call it makes
// as a ToolInvocation { name, args, result?, error? }, but those were previously
// only console.logged and then discarded (processSetterReply.ts) — so a booking
// failure like BOOK-1 was DB-blind: there was no row showing whether
// get-available-slots / book-appointments even fired or what GHL returned.
//
// This writes them to the PLATFORM Supabase `tool_invocations` table (alongside
// error_logs / dm_executions) as one batched insert. It is best-effort and NEVER
// throws: a persistence hiccup must not break the SMS reply (same contract as the
// chat_history write).

import type { ToolInvocation } from "./setterToolLoop.ts";

// Cap a single result blob so a large get-available-slots payload can't bloat the
// jsonb column. ~32k chars of JSON is plenty for diagnosis.
const MAX_RESULT_JSON_CHARS = 32000;

type MinimalSupabase = {
  from: (table: string) => {
    insert: (rows: unknown) => Promise<{ error: unknown }>;
  };
};

export type PersistToolInvocationsArgs = {
  supabase: MinimalSupabase;
  clientId: string;
  leadId: string;
  setterSlot: string;
  source: string;
  invocations: ToolInvocation[];
};

export type PersistToolInvocationsResult = {
  ok: boolean;
  count: number;
  error?: string;
};

function capResult(value: unknown): unknown {
  if (value === undefined) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { truncated: true, note: "unserializable result" };
  }
  if (json.length > MAX_RESULT_JSON_CHARS) {
    return { truncated: true, preview: json.slice(0, 2000) };
  }
  return value;
}

export async function persistToolInvocations(
  args: PersistToolInvocationsArgs,
): Promise<PersistToolInvocationsResult> {
  const { supabase, clientId, leadId, setterSlot, source, invocations } = args;
  if (!invocations || invocations.length === 0) {
    return { ok: true, count: 0 };
  }

  const rows = invocations.map((inv, index) => ({
    client_id: clientId,
    lead_id: leadId,
    setter_slot: setterSlot,
    source,
    invocation_index: index,
    name: inv.name,
    args: inv.args ?? null,
    result: capResult(inv.result),
    error: inv.error ?? null,
  }));

  try {
    const { error } = await supabase.from("tool_invocations").insert(rows);
    if (error) {
      const message = (error as { message?: string })?.message ?? String(error);
      return { ok: false, count: 0, error: message };
    }
    return { ok: true, count: rows.length };
  } catch (err) {
    return { ok: false, count: 0, error: (err as Error)?.message ?? String(err) };
  }
}
