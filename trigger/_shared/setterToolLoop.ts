// §3.12 — the SMS setter agentic tool loop.
//
// Provider-agnostic by design: the OpenRouter call and the voice-booking-tools
// HTTP call are injected as callLlm/callTool closures (built in
// processSetterReply), so this control flow + its safety properties are
// unit-testable without real network calls. The loop:
//   1. asks the LLM (with tools) for the next step,
//   2. if it returns tool_calls, executes each against voice-booking-tools
//      (engine-injected identity ALWAYS overrides model-supplied identity),
//      folds the results back as role:"tool" turns, and re-asks,
//   3. when the LLM returns plain content, that's the reply.
// Safety: identity injection wins, an iteration cap with a forced no-tools
// finalization, graceful degradation when a tool errors or the model can't
// tool-call. The loop never throws on a tool failure — a booking hiccup must
// never break the SMS reply.

import type { OpenAiTool } from "./setterTools.ts";

export type SetterToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmTurn = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: SetterToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type LlmResult = { content: string | null; toolCalls: SetterToolCall[] };

export type CallLlm = (args: {
  messages: LlmTurn[];
  tools?: OpenAiTool[];
  toolChoice: "auto" | "none";
}) => Promise<LlmResult>;

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export type ToolInvocation = {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

export type RunSetterToolLoopArgs = {
  messages: LlmTurn[];
  tools: OpenAiTool[];
  validToolNames: ReadonlySet<string>;
  identity: Record<string, unknown>;
  callLlm: CallLlm;
  callTool: CallTool;
  maxIterations?: number;
};

export type RunSetterToolLoopResult = {
  finalText: string;
  toolInvocations: ToolInvocation[];
  transcript: LlmTurn[];
};

// Thrown by the callLlm closure when the model/provider rejects the `tools`
// param (some OpenRouter models 400 on function-calling). The loop catches it
// and degrades to a plain reply rather than failing the SMS.
export class ToolsUnsupportedError extends Error {
  constructor(message = "model does not support tool calling") {
    super(message);
    this.name = "ToolsUnsupportedError";
  }
}

const DEFAULT_MAX_ITERATIONS = 4;
const MAX_TOOL_RESULT_CHARS = 6000;

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string): string {
  return s.length > MAX_TOOL_RESULT_CHARS ? `${s.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]` : s;
}

export async function runSetterToolLoop(
  args: RunSetterToolLoopArgs,
): Promise<RunSetterToolLoopResult> {
  const { tools, validToolNames, identity, callLlm, callTool } = args;
  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const transcript: LlmTurn[] = [...args.messages];
  const toolInvocations: ToolInvocation[] = [];

  // Force a final, user-facing reply with tools disabled (used on the iteration
  // cap and when tools are unsupported).
  const finalize = async (): Promise<string> => {
    const res = await callLlm({ messages: transcript, toolChoice: "none" });
    return res.content ?? "";
  };

  for (let i = 0; i < maxIterations; i++) {
    let res: LlmResult;
    try {
      res = await callLlm({ messages: transcript, tools, toolChoice: "auto" });
    } catch (err) {
      if (err instanceof ToolsUnsupportedError) {
        return { finalText: await finalize(), toolInvocations, transcript };
      }
      throw err;
    }

    const calls = res.toolCalls ?? [];
    if (calls.length === 0) {
      return { finalText: res.content ?? "", toolInvocations, transcript };
    }

    // Record the assistant's tool-call turn before the tool results.
    transcript.push({ role: "assistant", content: res.content ?? null, tool_calls: calls });

    for (const call of calls) {
      const name = call.function.name;
      let result: unknown;
      let error: string | undefined;
      let finalArgs: Record<string, unknown> = {};

      if (!validToolNames.has(name)) {
        error = `unknown tool: ${name}`;
        result = { error };
      } else {
        let parsed: Record<string, unknown> = {};
        try {
          const p = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          if (p && typeof p === "object" && !Array.isArray(p)) {
            parsed = p as Record<string, unknown>;
          }
        } catch {
          // malformed tool arguments → treat as empty; identity injection below
          // still pins the contact so a booking can't misroute.
        }
        // Identity LAST so engine-injected contactId/phone/email/timeZone/source
        // always override anything the model supplied.
        finalArgs = { ...parsed, ...identity };
        try {
          result = await callTool(name, finalArgs);
        } catch (err) {
          error = (err as Error)?.message ?? String(err);
          result = { error };
        }
      }

      toolInvocations.push({ name, args: finalArgs, result, error });
      transcript.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: truncate(safeStringify(result)),
      });
    }
  }

  // Iteration cap reached while still tool-calling — force a wrap-up reply.
  return { finalText: await finalize(), toolInvocations, transcript };
}
