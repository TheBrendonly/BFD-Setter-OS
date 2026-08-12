import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRetellConfigSnapshot,
  isRestorableSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
} from "./snapshot.ts";

// Full-fidelity snapshot (2026-08-12 overnight build, spec item 1).
//
// The v0 snapshot shipped for F9 drift detection; pollRetellDrift + computeDriftState
// still read the stored jsonb. These tests exist to prove the widening is a strict
// SUPERSET: the "v0 thin contract" case below hard-codes the exact object v0 produced,
// so any future edit that renames, moves or re-derives one of those keys fails here
// rather than silently blinding the hourly drift poll.

const PULLED_AT = "2026-08-12T13:00:00.000Z";

const AGENT = {
  agent_id: "agent_abc",
  agent_name: "Main Outbound",
  version: 14,
  is_published: true,
  last_modification_timestamp: 1786000000000,
  voice_id: "11labs-Gary",
  language: "en-AU",
  response_engine: { type: "retell-llm", llm_id: "llm_xyz", version: 14 },
  webhook_url: "https://example.test/hook",
  webhook_events: ["call_ended", "call_analyzed"],
  voice_model: "eleven_turbo_v2",
  voice_temperature: 1,
  responsiveness: 0.8,
  enable_backchannel: true,
  boosted_keywords: ["refinance"],
  voicemail_option: { action: { type: "hangup" } },
  post_call_analysis_model: "gpt-4.1",
};

const LLM = {
  llm_id: "llm_xyz",
  model: "gpt-4.1",
  version: 14,
  general_prompt: "You are Gary.\nDisclose that you are an AI.",
  begin_message: "Hey, this is Gary.",
  start_speaker: "agent",
  model_temperature: 0,
  model_high_priority: true,
  knowledge_base_ids: ["kb_1"],
  default_dynamic_variables: { first_name: "", last_name: "" },
  general_tools: [
    {
      type: "custom",
      name: "get-available-slots",
      url: "https://example.test/voice-booking-tools",
      headers: { "x-intake-secret": "SECRET" },
      query_params: { "function-type": "get-available-slots" },
    },
    { type: "end_call", name: "end_call" },
  ],
};

const FLOW = {
  conversation_flow_id: "flow_1",
  nodes: [{ id: "n1" }, { id: "n2" }],
  start_node_id: "n1",
};

const CF_AGENT = {
  agent_id: "agent_cf",
  agent_name: "Flow Agent",
  version: 3,
  is_published: false,
  last_modification_timestamp: 1786000000001,
  voice_id: "11labs-Anna",
  language: "en-AU",
  response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1", version: 3 },
};

Deno.test("v0 thin contract: every legacy key keeps its name, position and value", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "agent_abc",
    agent: AGENT,
    llm: LLM,
    flow: null,
    pulledAt: PULLED_AT,
  });

  // The exact v0 agent sub-object, hard-coded.
  assertEquals(snap.pulled_at, PULLED_AT);
  assertEquals(snap.agent.agent_id, "agent_abc");
  assertEquals(snap.agent.agent_name, "Main Outbound");
  assertEquals(snap.agent.version, 14);
  assertEquals(snap.agent.is_published, true);
  assertEquals(snap.agent.last_modification_timestamp, 1786000000000);
  assertEquals(snap.agent.voice_id, "11labs-Gary");
  assertEquals(snap.agent.language, "en-AU");
  assertEquals(snap.agent.engine_type, "retell-llm");

  // The exact v0 llm sub-object, hard-coded.
  assertEquals(snap.llm!.llm_id, "llm_xyz");
  assertEquals(snap.llm!.model, "gpt-4.1");
  assertEquals(snap.llm!.version, 14);
  assertEquals(snap.llm!.general_prompt_present, true);
  assertEquals(snap.llm!.general_prompt_chars, LLM.general_prompt.length);
  assertEquals(snap.llm!.begin_message_present, true);
  assertEquals(snap.llm!.start_speaker, "agent");
  assertEquals(snap.llm!.tools, ["get-available-slots", "end_call"]);
  assertEquals(snap.llm!.booking_tools_present, true);
});

Deno.test("schema_version is stamped and pulled_at is the caller's value, not wall clock", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "agent_abc",
    agent: AGENT,
    llm: LLM,
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.schema_version, SNAPSHOT_SCHEMA_VERSION);
  assertEquals(snap.schema_version, 1);
  assertEquals(snap.pulled_at, PULLED_AT);
});

Deno.test("DRIFT CONTRACT: booking_tools_present is a boolean both ways", () => {
  // trigger/_shared/retellDrift.ts:49 reads exactly this field, strict === true.
  const withTools = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: LLM,
    flow: null,
    pulledAt: PULLED_AT,
  });
  const withoutTools = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: { ...LLM, general_tools: [{ type: "end_call", name: "end_call" }] },
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(typeof withTools.llm!.booking_tools_present, "boolean");
  assertEquals(typeof withoutTools.llm!.booking_tools_present, "boolean");
  assertEquals(withTools.llm!.booking_tools_present, true);
  assertEquals(withoutTools.llm!.booking_tools_present, false);
});

Deno.test("tools carries names only, in order, dropping non-string names", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: {
      ...LLM,
      general_tools: [
        { name: "book-appointments" },
        { name: 42 },
        { name: "end_call" },
        { type: "custom" },
      ],
    },
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.llm!.tools, ["book-appointments", "end_call"]);
});

Deno.test("empty general_tools -> tools [] and booking_tools_present false", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: { ...LLM, general_tools: [] },
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.llm!.tools, []);
  assertEquals(snap.llm!.booking_tools_present, false);
});

Deno.test("general_prompt_chars tracks the real length; empty prompt -> present false", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: { ...LLM, general_prompt: "", begin_message: "" },
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.llm!.general_prompt_present, false);
  assertEquals(snap.llm!.general_prompt_chars, 0);
  assertEquals(snap.llm!.begin_message_present, false);
});

Deno.test("FAT: prompt, begin_message and general_tools are stored verbatim", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: LLM,
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.llm!.general_prompt, LLM.general_prompt);
  assertEquals(snap.llm!.begin_message, LLM.begin_message);
  // Deep-equal including nested headers/query_params — this is what makes restore possible.
  assertEquals(snap.llm!.general_tools, LLM.general_tools);
  assertEquals(snap.llm!.knowledge_base_ids, ["kb_1"]);
  assertEquals(snap.llm!.default_dynamic_variables, { first_name: "", last_name: "" });
  assertEquals(snap.llm!.model_temperature, 0);
});

Deno.test("FAT: agent-level config captured, including response_engine", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: LLM,
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.agent.response_engine, AGENT.response_engine);
  assertEquals(snap.agent.webhook_url, "https://example.test/hook");
  assertEquals(snap.agent.webhook_events, ["call_ended", "call_analyzed"]);
  assertEquals(snap.agent.voicemail_option, { action: { type: "hangup" } });
  assertEquals(snap.agent.boosted_keywords, ["refinance"]);
});

Deno.test("absent Retell fields serialize as null, never undefined", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: { agent_id: "a", response_engine: { type: "retell-llm", llm_id: "l" } },
    llm: { llm_id: "l" },
    flow: null,
    pulledAt: PULLED_AT,
  });
  // Round-trip through JSON the way jsonb storage does: undefined would vanish.
  const round = JSON.parse(JSON.stringify(snap));
  assertEquals(round.agent.voice_temperature, null);
  assertEquals(round.agent.post_call_analysis_data, null);
  assertEquals(round.llm.model_temperature, null);
  assertEquals(round.llm.states, null);
  assert("voice_temperature" in round.agent, "key must survive the round trip");
  assert("model_temperature" in round.llm, "key must survive the round trip");
});

Deno.test("llm_id falls back to the agent's response_engine (v0 behaviour)", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: { general_prompt: "x" },
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.llm!.llm_id, "llm_xyz");
});

Deno.test("agent_id falls back to the supplied agentId when the payload omits it", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "fallback_agent",
    agent: { agent_name: "x" },
    llm: null,
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.agent.agent_id, "fallback_agent");
  assertEquals(snap.agent.engine_type, null);
  assertEquals(snap.llm, null);
  assertEquals(snap.flow, null);
});

Deno.test("conversation-flow agent: llm null, thin flow keys unchanged, definition verbatim", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "agent_cf",
    agent: CF_AGENT,
    llm: null,
    flow: FLOW,
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.llm, null);
  assertEquals(snap.agent.engine_type, "conversation-flow");
  // v0 thin flow keys
  assertEquals(snap.flow!.conversation_flow_id, "flow_1");
  assertEquals(snap.flow!.present, true);
  assertEquals(snap.flow!.node_count, 2);
  // fat
  assertEquals(snap.flow!.definition, FLOW);
});

Deno.test("conversation_flow_id comes off the agent's response_engine (v0 behaviour)", () => {
  const snap = buildRetellConfigSnapshot({
    agentId: "agent_cf",
    agent: CF_AGENT,
    llm: null,
    // Flow body without the id: v0 read it from the agent, so it must still resolve.
    flow: { nodes: [] },
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.flow!.conversation_flow_id, "flow_1");
  assertEquals(snap.flow!.node_count, 0);
});

Deno.test("flow.definition is nested, so a Retell key cannot clobber the v0 thin keys", () => {
  // A flow body that itself carries `present`/`node_count` must not overwrite ours.
  const snap = buildRetellConfigSnapshot({
    agentId: "agent_cf",
    agent: CF_AGENT,
    llm: null,
    flow: { conversation_flow_id: "flow_1", nodes: [{ id: "n1" }], present: "HOSTILE", node_count: 999 },
    pulledAt: PULLED_AT,
  });
  assertEquals(snap.flow!.present, true);
  assertEquals(snap.flow!.node_count, 1);
});

Deno.test("isRestorableSnapshot: v0 thin snapshots are refused, v1 fat ones accepted", () => {
  const v0 = {
    pulled_at: PULLED_AT,
    agent: { agent_id: "a" },
    llm: { general_prompt_present: true, general_prompt_chars: 120, tools: [] },
    flow: null,
  };
  assertEquals(isRestorableSnapshot(v0), false);
  assertEquals(isRestorableSnapshot(null), false);
  assertEquals(isRestorableSnapshot({ schema_version: 1, llm: null, flow: null }), false);

  const v1 = buildRetellConfigSnapshot({
    agentId: "a",
    agent: AGENT,
    llm: LLM,
    flow: null,
    pulledAt: PULLED_AT,
  });
  assertEquals(isRestorableSnapshot(v1), true);
});
