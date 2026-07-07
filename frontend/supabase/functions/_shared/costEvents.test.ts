import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCostEvent } from "./costEvents.ts";

// Pure builder for public.execution_cost_events. Tests cover shape, defaults,
// cost sanitization (numeric(12,6)), nullable execution linkage, and validation.

Deno.test("voice event: real cost, full linkage, not estimated by default", () => {
  const row = buildCostEvent("voice", {
    clientId: "client-1",
    executionId: "exec-1",
    workflowId: "wf-1",
    leadId: "ghl-contact-9",
    providerRef: "call_abc",
    quantity: 3.5,
    unit: "minutes",
    costUsd: 0.245,
  });
  assertEquals(row, {
    execution_id: "exec-1",
    client_id: "client-1",
    workflow_id: "wf-1",
    lead_id: "ghl-contact-9",
    cost_kind: "voice",
    provider_ref: "call_abc",
    quantity: 3.5,
    unit: "minutes",
    cost_usd: 0.245,
    is_estimated: false,
  });
});

Deno.test("inbound voice: null execution/workflow/lead is allowed", () => {
  const row = buildCostEvent("voice", {
    clientId: "client-1",
    providerRef: "call_inbound",
    costUsd: 0.1,
  });
  assertEquals(row.execution_id, null);
  assertEquals(row.workflow_id, null);
  assertEquals(row.lead_id, null);
  assertEquals(row.quantity, null);
  assertEquals(row.unit, null);
});

Deno.test("sms event: estimated flag + segment quantity", () => {
  const row = buildCostEvent("sms", {
    clientId: "client-1",
    executionId: "exec-2",
    providerRef: "SM123",
    quantity: 2,
    unit: "segments",
    costUsd: 0.0166,
    isEstimated: true,
  });
  assertEquals(row.cost_kind, "sms");
  assertEquals(row.is_estimated, true);
  assertEquals(row.quantity, 2);
  assertEquals(row.cost_usd, 0.0166);
});

Deno.test("cost is rounded to 6 dp (numeric(12,6))", () => {
  const row = buildCostEvent("llm", { clientId: "c", costUsd: 0.12345678 });
  assertEquals(row.cost_usd, 0.123457);
});

Deno.test("non-finite / negative cost collapses to 0", () => {
  assertEquals(buildCostEvent("llm", { clientId: "c", costUsd: NaN }).cost_usd, 0);
  assertEquals(buildCostEvent("llm", { clientId: "c", costUsd: -5 }).cost_usd, 0);
  assertEquals(
    buildCostEvent("llm", { clientId: "c", costUsd: Infinity }).cost_usd,
    0,
  );
});

Deno.test("non-finite quantity becomes null", () => {
  assertEquals(
    buildCostEvent("sms", { clientId: "c", costUsd: 0.01, quantity: NaN }).quantity,
    null,
  );
});

Deno.test("occurred_at omitted unless provided (DB defaults now())", () => {
  const without = buildCostEvent("llm", { clientId: "c", costUsd: 0.01 });
  assertEquals("occurred_at" in without, false);
  const withTs = buildCostEvent("llm", {
    clientId: "c",
    costUsd: 0.01,
    occurredAt: "2026-07-07T00:00:00.000Z",
  });
  assertEquals(withTs.occurred_at, "2026-07-07T00:00:00.000Z");
});

Deno.test("invalid cost_kind throws", () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => buildCostEvent("email" as any, { clientId: "c", costUsd: 1 }),
    Error,
    "invalid cost_kind",
  );
});

Deno.test("missing clientId throws", () => {
  assertThrows(
    () => buildCostEvent("llm", { clientId: "", costUsd: 1 }),
    Error,
    "clientId is required",
  );
});
