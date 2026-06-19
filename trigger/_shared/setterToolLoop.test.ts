// TDD for the SMS setter agentic tool loop (§3.12). Runs via:
//   node --experimental-strip-types --test trigger/_shared/setterToolLoop.test.ts
//
// The loop is provider-agnostic: OpenRouter and voice-booking-tools HTTP live
// in injected callLlm/callTool closures (built in processSetterReply), so the
// loop's control flow + safety properties are unit-testable without real HTTP.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  runSetterToolLoop,
  ToolsUnsupportedError,
  type LlmResult,
  type LlmTurn,
  type RunSetterToolLoopArgs,
  type SetterToolCall,
} from "./setterToolLoop.ts";
import { SETTER_TOOLS, SETTER_TOOL_NAMES } from "./setterTools.ts";

function toolCall(id: string, name: string, args: Record<string, unknown>): SetterToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const IDENTITY = {
  contactId: "LEAD123",
  phone: "+61400000000",
  email: "lead@example.com",
  timeZone: "Australia/Brisbane",
  source: "sms",
};

type LoopOverrides =
  & Partial<RunSetterToolLoopArgs>
  & Pick<RunSetterToolLoopArgs, "callLlm" | "callTool">;

function baseArgs(overrides: LoopOverrides): RunSetterToolLoopArgs {
  return {
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ] as LlmTurn[],
    tools: SETTER_TOOLS,
    validToolNames: SETTER_TOOL_NAMES,
    identity: IDENTITY,
    ...overrides,
  };
}

test("(a) no tool_calls => returns content unchanged, callTool never invoked", async () => {
  let llmCalls = 0;
  let toolCalls = 0;
  const callLlm = async () => {
    llmCalls++;
    return { content: '{"messages":["hi there"]}', toolCalls: [] };
  };
  const callTool = async () => {
    toolCalls++;
    return {};
  };
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.equal(r.finalText, '{"messages":["hi there"]}');
  assert.equal(toolCalls, 0);
  assert.equal(llmCalls, 1);
  assert.equal(r.toolInvocations.length, 0);
});

test("(b) one tool_call => executes, folds result, re-calls, returns final content", async () => {
  const seq: LlmResult[] = [
    { content: null, toolCalls: [toolCall("1", "book-appointments", { startDateTime: "2026-06-20T14:00:00" })] },
    { content: '{"messages":["You are booked for Sat 2pm"]}', toolCalls: [] },
  ];
  let i = 0;
  const callLlm = async () => seq[i++];
  const captured: Array<{ name: string; args: Record<string, unknown> }> = [];
  const callTool = async (name: string, args: Record<string, unknown>) => {
    captured.push({ name, args });
    return { id: "appt1", booked: true };
  };
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, "book-appointments");
  assert.equal(captured[0].args.startDateTime, "2026-06-20T14:00:00");
  assert.equal(captured[0].args.contactId, "LEAD123"); // identity injected
  assert.match(r.finalText, /booked/);
  assert.equal(r.toolInvocations.length, 1);
  assert.equal(r.toolInvocations[0].error, undefined);
});

test("(c) tool throws => loop does NOT throw, folds error, model recovers gracefully", async () => {
  const seq: LlmResult[] = [
    { content: null, toolCalls: [toolCall("1", "book-appointments", { startDateTime: "x" })] },
    { content: '{"messages":["Sorry, I hit a snag booking that, let me try again"]}', toolCalls: [] },
  ];
  let i = 0;
  const callLlm = async () => seq[i++];
  const callTool = async () => {
    throw new Error("GHL book-appointments failed 502");
  };
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.match(r.finalText, /snag/);
  assert.equal(r.toolInvocations.length, 1);
  assert.match(String(r.toolInvocations[0].error), /502/);
  // the error must have been fed back to the model as the tool result
  const toolMsg = r.transcript.find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.match(String(toolMsg!.content), /502/);
});

test("(c-variant) tools unsupported => retry without tools, reply-only, callTool never invoked", async () => {
  let withTools = 0;
  let withoutTools = 0;
  const callLlm = async ({ tools, toolChoice }: { tools?: unknown[]; toolChoice: string }) => {
    if (tools && tools.length && toolChoice !== "none") {
      withTools++;
      throw new ToolsUnsupportedError("model does not support tools");
    }
    withoutTools++;
    return { content: '{"messages":["hello, how can I help?"]}', toolCalls: [] };
  };
  const callTool = async () => {
    throw new Error("callTool must not run when tools are unsupported");
  };
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.equal(r.finalText, '{"messages":["hello, how can I help?"]}');
  assert.equal(withTools, 1);
  assert.equal(withoutTools, 1);
  assert.equal(r.toolInvocations.length, 0);
});

test("(d) engine-injected identity overrides model-supplied phone/contactId/email/source", async () => {
  const seq: LlmResult[] = [
    {
      content: null,
      toolCalls: [
        toolCall("1", "book-appointments", {
          startDateTime: "2026-06-20T14:00:00",
          phone: "+19995551234",
          contactId: "ATTACKER",
          email: "evil@example.com",
          source: "voice_call",
        }),
      ],
    },
    { content: '{"messages":["done"]}', toolCalls: [] },
  ];
  let i = 0;
  const callLlm = async () => seq[i++];
  let capturedArgs: Record<string, unknown> = {};
  const callTool = async (_name: string, args: Record<string, unknown>) => {
    capturedArgs = args;
    return { booked: true };
  };
  await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.equal(capturedArgs.contactId, "LEAD123");
  assert.equal(capturedArgs.phone, "+61400000000");
  assert.equal(capturedArgs.email, "lead@example.com");
  assert.equal(capturedArgs.source, "sms");
  // the model's genuine decision variable survives
  assert.equal(capturedArgs.startDateTime, "2026-06-20T14:00:00");
});

test("(e) iteration cap => exactly maxIterations tool executions then a forced no-tools finalization", async () => {
  let llmCalls = 0;
  let toolCalls = 0;
  const callLlm = async ({ toolChoice }: { toolChoice: string }) => {
    llmCalls++;
    if (toolChoice === "none") {
      return { content: '{"messages":["Let me get back to you shortly"]}', toolCalls: [] };
    }
    return {
      content: null,
      toolCalls: [toolCall(String(llmCalls), "get-available-slots", { startDateTime: "a", endDateTime: "b" })],
    };
  };
  const callTool = async () => {
    toolCalls++;
    return { "2026-06-20": { slots: [] } };
  };
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool, maxIterations: 3 }));
  assert.equal(toolCalls, 3); // capped
  assert.match(r.finalText, /get back to you/);
  assert.equal(llmCalls, 4); // 3 tool iterations + 1 forced finalization
});

test("(f) slot_unavailable result is forwarded verbatim, not treated as success/error", async () => {
  const unavailable = {
    booked: false,
    status: "slot_unavailable",
    available_slots: { "2026-06-21": ["10:00", "11:00"] },
    retry_with_available_slots: true,
  };
  const seq: LlmResult[] = [
    { content: null, toolCalls: [toolCall("1", "book-appointments", { startDateTime: "2026-06-20T14:00:00" })] },
    { content: '{"messages":["That time is taken — 10am or 11am on the 21st?"]}', toolCalls: [] },
  ];
  let i = 0;
  const callLlm = async () => seq[i++];
  const callTool = async () => unavailable;
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.equal(r.toolInvocations[0].error, undefined);
  assert.deepEqual(r.toolInvocations[0].result, unavailable);
  const toolMsg = r.transcript.find((m) => m.role === "tool");
  assert.match(String(toolMsg!.content), /available_slots/);
});

test("unknown tool name => folded as an error result, callTool not invoked for it", async () => {
  const seq: LlmResult[] = [
    { content: null, toolCalls: [toolCall("1", "delete-everything", { foo: "bar" })] },
    { content: '{"messages":["I can\'t do that, but I can book you in"]}', toolCalls: [] },
  ];
  let i = 0;
  const callLlm = async () => seq[i++];
  let toolRan = false;
  const callTool = async () => {
    toolRan = true;
    return {};
  };
  const r = await runSetterToolLoop(baseArgs({ callLlm, callTool }));
  assert.equal(toolRan, false);
  assert.match(String(r.toolInvocations[0].error), /unknown tool/i);
});
