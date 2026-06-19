import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSmsAnalysisMessages,
  buildSmsConversationText,
  buildSmsFieldWrites,
  normalizeModel,
  parseSmsAnalysis,
} from "./smsAnalysis.ts";

Deno.test("normalizeModel: strips a stray leading ~ and whitespace (live data anomaly)", () => {
  assertEquals(normalizeModel("~google/gemini-flash-latest"), "google/gemini-flash-latest");
  assertEquals(normalizeModel("  openai/gpt-4.1-nano "), "openai/gpt-4.1-nano");
  assertEquals(normalizeModel("~~ google/gemini "), "google/gemini");
});

Deno.test("normalizeModel: empty / null / only-noise → null (caller falls back to default)", () => {
  assertEquals(normalizeModel(null), null);
  assertEquals(normalizeModel(""), null);
  assertEquals(normalizeModel("  ~ "), null);
});

Deno.test("buildSmsConversationText: labels inbound=Lead, outbound=Setter, in order", () => {
  const text = buildSmsConversationText([
    { direction: "outbound", body: "Hi, are you still keen?" },
    { direction: "inbound", body: "Yes! When can we chat?" },
    { direction: "outbound", body: "How about tomorrow 10am?" },
  ]);
  assertEquals(
    text,
    "Setter: Hi, are you still keen?\nLead: Yes! When can we chat?\nSetter: How about tomorrow 10am?",
  );
});

Deno.test("buildSmsAnalysisMessages: returns a system + user pair, JSON instruction in system", () => {
  const msgs = buildSmsAnalysisMessages("Lead: hi");
  assertEquals(msgs.length, 2);
  assertEquals(msgs[0].role, "system");
  assertEquals(msgs[1].role, "user");
  assertEquals(msgs[1].content, "Lead: hi");
  // system prompt must ask for strict JSON with the 4 keys
  for (const key of ["sentiment", "intent", "qualified", "summary", "JSON"]) {
    if (!msgs[0].content.includes(key)) throw new Error(`system prompt missing ${key}`);
  }
});

Deno.test("parseSmsAnalysis: parses plain JSON", () => {
  const a = parseSmsAnalysis(
    '{"sentiment":"positive","intent":"interested","qualified":true,"summary":"Wants a call."}',
  );
  assertEquals(a, { sentiment: "positive", intent: "interested", qualified: true, summary: "Wants a call." });
});

Deno.test("parseSmsAnalysis: parses JSON inside ```json fences + prose", () => {
  const a = parseSmsAnalysis(
    'Here you go:\n```json\n{"sentiment":"negative","intent":"not_interested","qualified":false,"summary":"Asked to stop."}\n```\nthanks',
  );
  assertEquals(a?.sentiment, "negative");
  assertEquals(a?.qualified, false);
  assertEquals(a?.summary, "Asked to stop.");
});

Deno.test("parseSmsAnalysis: coerces qualified yes/no/strings to boolean", () => {
  assertEquals(parseSmsAnalysis('{"qualified":"yes"}')?.qualified, true);
  assertEquals(parseSmsAnalysis('{"qualified":"true"}')?.qualified, true);
  assertEquals(parseSmsAnalysis('{"qualified":"no"}')?.qualified, false);
  assertEquals(parseSmsAnalysis('{"qualified":false}')?.qualified, false);
  assertEquals(parseSmsAnalysis('{"qualified":"maybe"}')?.qualified, null);
});

Deno.test("parseSmsAnalysis: returns null on unparseable input", () => {
  assertEquals(parseSmsAnalysis("not json at all"), null);
  assertEquals(parseSmsAnalysis(""), null);
});

Deno.test("buildSmsFieldWrites: maps analysis to id/value writes, qualified→string, drops nulls", () => {
  const writes = buildSmsFieldWrites(
    { sentiment: "positive", intent: "interested", qualified: true, summary: "Keen." },
    { sentiment: "id_s", intent: "id_i", qualified: "id_q", summary: "id_sum" },
  );
  assertEquals(writes.find((w) => w.id === "id_s")?.value, "positive");
  assertEquals(writes.find((w) => w.id === "id_i")?.value, "interested");
  assertEquals(writes.find((w) => w.id === "id_q")?.value, "true");
  assertEquals(writes.find((w) => w.id === "id_sum")?.value, "Keen.");
});

Deno.test("buildSmsFieldWrites: drops writes with a null id or a null value", () => {
  const writes = buildSmsFieldWrites(
    { sentiment: "positive", intent: null, qualified: null, summary: "x" },
    { sentiment: null, intent: "id_i", qualified: "id_q", summary: "id_sum" },
  );
  // sentiment id null → dropped; intent value null → dropped; qualified null → dropped
  assertEquals(writes.length, 1);
  assertEquals(writes[0].id, "id_sum");
});
