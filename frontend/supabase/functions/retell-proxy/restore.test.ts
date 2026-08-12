import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRestorePayloads,
  CORE_AGENT_FIELDS,
  CORE_LLM_FIELDS,
  decideRestoreGuard,
  executeRestoreSequence,
  planFieldStrip,
  STRIPPABLE_AGENT_FIELDS,
  STRIPPABLE_LLM_FIELDS,
  type RestoreIo,
} from "./restore.ts";
import { buildRetellConfigSnapshot } from "./snapshot.ts";

// Restore from a full-fidelity snapshot (2026-08-12 overnight build, spec item 1).
//
// These tests are calibrated against the live BFD tenant as it stood on 2026-08-12:
// slot 4 carries a v0 THIN snapshot (retell_synced_version 13), so the "v0 refusal"
// case below is not hypothetical, it is what the first real restore attempt hits.

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
};

const LLM = {
  llm_id: "llm_xyz",
  model: "gpt-4.1",
  version: 14,
  general_prompt: "You are Gary.\n\n## DYNAMIC VARIABLES\n- Slots: {{available_time_slots}}",
  begin_message: "Hey, this is Gary.",
  start_speaker: "agent",
  model_temperature: 0,
  knowledge_base_ids: ["kb_1"],
  general_tools: [{ type: "custom", name: "get-available-slots", url: "https://x.test" }],
};

const FAT = buildRetellConfigSnapshot({
  agentId: "agent_abc",
  agent: AGENT,
  llm: LLM,
  flow: null,
  pulledAt: PULLED_AT,
});

const V0_THIN = {
  pulled_at: PULLED_AT,
  agent: { agent_id: "agent_abc", version: 13, engine_type: "retell-llm" },
  llm: { llm_id: "llm_xyz", general_prompt_present: true, general_prompt_chars: 120, tools: [] },
  flow: null,
};

// ── buildRestorePayloads ─────────────────────────────────────────────────────

Deno.test("a v0 thin snapshot is refused: it cannot rebuild anything", () => {
  const r = buildRestorePayloads(V0_THIN);
  assertEquals(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assertEquals(r.code, "snapshot_not_restorable");
  assertEquals(r.status, 409);
});

Deno.test("a missing or malformed snapshot is refused", () => {
  for (const bad of [null, undefined, {}, { schema_version: 1, llm: null, flow: null }]) {
    const r = buildRestorePayloads(bad);
    assertEquals(r.ok, false, `expected refusal for ${JSON.stringify(bad)}`);
  }
});

Deno.test("general_prompt is byte-equal: no dynamic-vars block is re-appended", () => {
  const r = buildRestorePayloads(FAT);
  assert(r.ok);
  assertEquals(r.plan.llmPayload.general_prompt, LLM.general_prompt);
  // The prompt already carries exactly one {{available_time_slots}} from the original
  // push. Re-appending the block would make it two and trip the latency guard.
  const count = String(r.plan.llmPayload.general_prompt).match(/\{\{available_time_slots\}\}/g)!.length;
  assertEquals(count, 1);
});

Deno.test("general_tools restore verbatim; override replaces them when supplied", () => {
  const plain = buildRestorePayloads(FAT);
  assert(plain.ok);
  assertEquals(plain.plan.llmPayload.general_tools, LLM.general_tools);

  const override = [{ type: "custom", name: "get-available-slots", url: "https://rotated.test" }];
  const withOverride = buildRestorePayloads(FAT, { generalToolsOverride: override });
  assert(withOverride.ok);
  assertEquals(withOverride.plan.llmPayload.general_tools, override);
});

Deno.test("agentPatch omits read-only fields Retell rejects", () => {
  const r = buildRestorePayloads(FAT);
  assert(r.ok);
  for (const forbidden of [
    "agent_id",
    "version",
    "is_published",
    "last_modification_timestamp",
    "engine_type",
    "response_engine",
  ]) {
    assertEquals(forbidden in r.plan.agentPatch, false, `${forbidden} must not be PATCHed`);
  }
  assertEquals(r.plan.agentPatch.agent_name, "Main Outbound");
  assertEquals(r.plan.agentPatch.voice_id, "11labs-Gary");
});

Deno.test("null-valued optional fields are omitted, never PATCHed over live settings", () => {
  const r = buildRestorePayloads(FAT);
  assert(r.ok);
  // AGENT never set these, so the snapshot holds null and the patch must skip them.
  assertEquals("ambient_sound" in r.plan.agentPatch, false);
  assertEquals("reminder_max_count" in r.plan.agentPatch, false);
  assertEquals("states" in r.plan.llmPayload, false);
  // ...but captured values do go.
  assertEquals(r.plan.llmPayload.model_temperature, 0);
  assertEquals(r.plan.llmPayload.knowledge_base_ids, ["kb_1"]);
});

Deno.test("core LLM fields always go, including an explicitly null begin_message", () => {
  const noBegin = buildRetellConfigSnapshot({
    agentId: "agent_abc",
    agent: AGENT,
    llm: { ...LLM, begin_message: null },
    flow: null,
    pulledAt: PULLED_AT,
  });
  const r = buildRestorePayloads(noBegin);
  assert(r.ok);
  assertEquals("begin_message" in r.plan.llmPayload, true);
  assertEquals(r.plan.llmPayload.begin_message, null);
  assertEquals(r.plan.llmPayload.start_speaker, "agent");
  assertEquals(r.plan.llmPayload.model, "gpt-4.1");
});

Deno.test("conversation-flow snapshots are refused for now, but stay archived", () => {
  const cf = buildRetellConfigSnapshot({
    agentId: "agent_cf",
    agent: {
      agent_id: "agent_cf",
      response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
    },
    llm: null,
    flow: { conversation_flow_id: "flow_1", nodes: [{ id: "n1" }] },
    pulledAt: PULLED_AT,
  });
  const r = buildRestorePayloads(cf);
  assertEquals(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assertEquals(r.code, "cf_restore_unsupported");
  // The archive itself is still complete.
  assertEquals((cf.flow as Record<string, unknown>).definition, {
    conversation_flow_id: "flow_1",
    nodes: [{ id: "n1" }],
  });
});

// ── planFieldStrip ───────────────────────────────────────────────────────────

Deno.test("a named strippable field is dropped and retried", () => {
  const payload = { general_prompt: "p", model_temperature: 0, knowledge_base_ids: [] };
  const out = planFieldStrip(
    400,
    'Retell API error [400]: "model_temperature" is not allowed',
    payload,
    STRIPPABLE_LLM_FIELDS,
    CORE_LLM_FIELDS,
  );
  assertEquals(out.action, "retry");
  if (out.action !== "retry") throw new Error("unreachable");
  assertEquals(out.dropped, ["model_temperature"]);
  assertEquals("model_temperature" in out.payload, false);
  assertEquals(out.payload.general_prompt, "p");
  assertEquals("knowledge_base_ids" in out.payload, true);
});

Deno.test("a dotted body path is resolved to its field name", () => {
  const payload = { agent_name: "x", voice_model: "eleven_turbo_v2" };
  const out = planFieldStrip(
    400,
    "Retell API error [400]: body.voice_model: Invalid enum value",
    payload,
    STRIPPABLE_AGENT_FIELDS,
    CORE_AGENT_FIELDS,
  );
  assertEquals(out.action, "retry");
  if (out.action !== "retry") throw new Error("unreachable");
  assertEquals(out.dropped, ["voice_model"]);
});

Deno.test("an opaque 400 drops the whole strippable set in ONE pass", () => {
  // Keeps "retry once" deterministic instead of iterating an unknown number of times.
  const payload = {
    general_prompt: "p",
    model_temperature: 0,
    knowledge_base_ids: [],
    default_dynamic_variables: {},
  };
  const out = planFieldStrip(400, "Retell API error [400]: Bad Request", payload, STRIPPABLE_LLM_FIELDS, CORE_LLM_FIELDS);
  assertEquals(out.action, "retry");
  if (out.action !== "retry") throw new Error("unreachable");
  assertEquals(out.dropped.sort(), ["default_dynamic_variables", "knowledge_base_ids", "model_temperature"]);
  assertEquals(out.payload, { general_prompt: "p" });
});

Deno.test("a rejected CORE field is fatal: never silently ship a degraded agent", () => {
  const payload = { general_prompt: "p", model_temperature: 0 };
  const out = planFieldStrip(
    400,
    'Retell API error [400]: "general_prompt" exceeds maximum length',
    payload,
    STRIPPABLE_LLM_FIELDS,
    CORE_LLM_FIELDS,
  );
  assertEquals(out.action, "fatal");
  if (out.action !== "fatal") throw new Error("unreachable");
  assertEquals(out.reason, "core_field_rejected");
  assertEquals(out.fields, ["general_prompt"]);
});

Deno.test("a named-but-absent field is not reported as dropped", () => {
  const payload = { general_prompt: "p", model_temperature: 0 };
  const out = planFieldStrip(
    400,
    'Retell API error [400]: "states" is not allowed',
    payload,
    STRIPPABLE_LLM_FIELDS,
    CORE_LLM_FIELDS,
  );
  assertEquals(out.action, "retry");
  if (out.action !== "retry") throw new Error("unreachable");
  assertEquals(out.dropped.includes("states"), false);
  assertEquals(out.dropped, ["model_temperature"]);
});

Deno.test("non-400 statuses are never stripped", () => {
  const out = planFieldStrip(429, "rate limited", { model_temperature: 0 }, STRIPPABLE_LLM_FIELDS, CORE_LLM_FIELDS);
  assertEquals(out.action, "fatal");
});

Deno.test("nothing strippable in the payload is fatal, not an empty retry", () => {
  const out = planFieldStrip(400, "Bad Request", { general_prompt: "p" }, STRIPPABLE_LLM_FIELDS, CORE_LLM_FIELDS);
  assertEquals(out.action, "fatal");
  if (out.action !== "fatal") throw new Error("unreachable");
  assertEquals(out.reason, "nothing_strippable");
});

// ── decideRestoreGuard ───────────────────────────────────────────────────────

const BASE_GUARD = {
  slotNumber: 10,
  snapshot: FAT,
  liveAgentId: "agent_abc",
  liveEngineType: "retell-llm",
  isLocked: false,
  force: false,
};

Deno.test("the happy path is allowed", () => {
  assertEquals(decideRestoreGuard(BASE_GUARD), { ok: true });
});

Deno.test("SLOT-MAP-1: slot 1 is refused with AND without force", () => {
  for (const force of [false, true]) {
    const r = decideRestoreGuard({ ...BASE_GUARD, slotNumber: 1, force });
    assertEquals(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assertEquals(r.code, "slot_map_1");
  }
});

Deno.test("a locked slot needs force (F9)", () => {
  const blocked = decideRestoreGuard({ ...BASE_GUARD, isLocked: true });
  assertEquals(blocked.ok, false);
  if (blocked.ok) throw new Error("unreachable");
  assertEquals(blocked.status, 423);
  assertEquals(blocked.code, "setter_retell_locked");

  assertEquals(decideRestoreGuard({ ...BASE_GUARD, isLocked: true, force: true }), { ok: true });
});

Deno.test("a repointed slot is refused: never push agent A's config onto agent B", () => {
  const r = decideRestoreGuard({ ...BASE_GUARD, liveAgentId: "agent_OTHER" });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assertEquals(r.status, 409);
  assertEquals(r.code, "snapshot_agent_mismatch");

  assertEquals(
    decideRestoreGuard({ ...BASE_GUARD, liveAgentId: "agent_OTHER", force: true }),
    { ok: true },
  );
});

Deno.test("an engine-type change is refused even with force", () => {
  const r = decideRestoreGuard({ ...BASE_GUARD, liveEngineType: "conversation-flow", force: true });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assertEquals(r.code, "engine_mismatch");
});

Deno.test("a slot with no agent is refused", () => {
  const r = decideRestoreGuard({ ...BASE_GUARD, liveAgentId: null });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assertEquals(r.code, "no_agent");
});

// ── executeRestoreSequence ───────────────────────────────────────────────────

function makeIo(overrides: Partial<RestoreIo> & { patchFailures?: Record<string, number> } = {}) {
  const calls: string[] = [];
  const failures = overrides.patchFailures ?? {};
  const io: RestoreIo = {
    retellFetch: (method, path) => {
      calls.push(`${method} ${path}`);
      const key = path.split("/")[0];
      if ((failures[key] ?? 0) > 0) {
        failures[key]--;
        const err = new Error(`Retell API error [400]: "model_temperature" is not allowed`) as
          & Error
          & { retellStatus: number };
        err.retellStatus = 400;
        throw err;
      }
      return Promise.resolve({ ok: true });
    },
    ensureDraft: (agentId) => {
      calls.push(`ensureDraft ${agentId}`);
      return Promise.resolve({ draftVersion: 15, llmId: "llm_draft" });
    },
    publish: (agentId, version) => {
      calls.push(`publish ${agentId} v${version}`);
      return Promise.resolve({ version: 15 });
    },
    latestPublishedVersion: (agentId) => {
      calls.push(`latestPublished ${agentId}`);
      return Promise.resolve(15);
    },
    repointPhones: (agentId) => {
      calls.push(`repoint ${agentId}`);
      return Promise.resolve();
    },
    statusOf: (e) => (e as { retellStatus?: number })?.retellStatus ?? null,
    ...overrides,
  };
  return { io, calls };
}

const PLAN = (() => {
  const r = buildRestorePayloads(FAT);
  if (!r.ok) throw new Error("fixture plan must build");
  return r.plan;
})();

Deno.test("happy path runs draft -> llm -> agent -> publish -> repoint, in order", async () => {
  const { io, calls } = makeIo();
  const out = await executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
    dryRun: false,
    versionDescription: "BFD restore",
  });
  assertEquals(calls, [
    "ensureDraft agent_abc",
    "PATCH update-retell-llm/llm_draft",
    "PATCH update-agent/agent_abc",
    "publish agent_abc v15",
    "latestPublished agent_abc",
    "repoint agent_abc",
  ]);
  assertEquals(out.publishedVersion, 15);
  assertEquals(out.publishWarning, null);
  assertEquals(out.retried, { llm: false, agent: false });
});

Deno.test("dryRun makes zero Retell calls and still reports the resolved llm", async () => {
  const { io, calls } = makeIo();
  const out = await executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
    dryRun: true,
    versionDescription: "BFD restore",
  });
  assertEquals(calls, []);
  assertEquals(out.dryRun, true);
  assertEquals(out.llmId, "llm_live");
  assertEquals(out.publishedVersion, null);
});

Deno.test("a 400 on the LLM PATCH strips once and retries, then continues", async () => {
  const { io, calls } = makeIo({ patchFailures: { "update-retell-llm": 1 } });
  const out = await executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
    dryRun: false,
    versionDescription: "BFD restore",
  });
  assertEquals(calls.filter((c) => c.startsWith("PATCH update-retell-llm")).length, 2);
  assertEquals(out.retried.llm, true);
  assertEquals(out.droppedFields.llm, ["model_temperature"]);
  assert(out.firstAttemptErrors.llm?.includes("model_temperature"));
  assertEquals(out.publishedVersion, 15);
});

Deno.test("two 400s on the LLM PATCH abort before publish or repoint", async () => {
  const { io, calls } = makeIo({ patchFailures: { "update-retell-llm": 2 } });
  await assertRejects(() =>
    executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
      dryRun: false,
      versionDescription: "BFD restore",
    })
  );
  assertEquals(calls.some((c) => c.startsWith("publish")), false);
  assertEquals(calls.some((c) => c.startsWith("repoint")), false);
});

Deno.test("an agent-PATCH 400 strips the AGENT payload only; the LLM PATCH stays single", async () => {
  const { io, calls } = makeIo({ patchFailures: { "update-agent": 1 } });
  const out = await executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
    dryRun: false,
    versionDescription: "BFD restore",
  });
  assertEquals(calls.filter((c) => c.startsWith("PATCH update-retell-llm")).length, 1);
  assertEquals(calls.filter((c) => c.startsWith("PATCH update-agent")).length, 2);
  assertEquals(out.retried, { llm: false, agent: true });
  assertEquals(out.droppedFields.llm, []);
});

Deno.test("a failed publish is a warning, not an exception, and leaves version null", async () => {
  const { io } = makeIo({
    publish: () => Promise.reject(new Error("publish exploded")),
  });
  const out = await executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
    dryRun: false,
    versionDescription: "BFD restore",
  });
  // Content landed; the caller must skip the synced-version re-baseline on this.
  assertEquals(out.publishedVersion, null);
  assertEquals(out.publishWarning, "publish exploded");
});

Deno.test("a draft with no llmId falls back to the live llm id", async () => {
  const { io, calls } = makeIo({
    ensureDraft: () => Promise.resolve({ draftVersion: 15, llmId: null }),
  });
  const out = await executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
    dryRun: false,
    versionDescription: "BFD restore",
  });
  assert(calls.includes("PATCH update-retell-llm/llm_live"));
  assertEquals(out.llmId, "llm_live");
});

Deno.test("a non-400 Retell failure propagates unstripped", async () => {
  const { io } = makeIo({
    retellFetch: () => {
      const err = new Error("Retell API error [500]: boom") as Error & { retellStatus: number };
      err.retellStatus = 500;
      throw err;
    },
  });
  await assertRejects(
    () =>
      executeRestoreSequence(io, PLAN, "agent_abc", "llm_live", {
        dryRun: false,
        versionDescription: "BFD restore",
      }),
    Error,
    "500",
  );
});
