// SEC-PII-LOGS-1 — redaction helper tests. Run under `deno test`.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redactPhone, redactEmail, redactBodyShape } from "./redact.ts";

Deno.test("redactPhone keeps last 4, hides the rest", () => {
  assertEquals(redactPhone("+61405482446"), "***2446");
  assertEquals(redactPhone("1234"), "***");
  assertEquals(redactPhone(null), "<none>");
  assertEquals(redactPhone(""), "<none>");
});

Deno.test("redactEmail keeps first char + domain", () => {
  assertEquals(redactEmail("brendan@buildingflowdigital.com"), "b***@buildingflowdigital.com");
  assertEquals(redactEmail("x@y.com"), "x***@y.com");
  assertEquals(redactEmail(null), "<none>");
  assertEquals(redactEmail("notanemail"), "***");
});

Deno.test("redactBodyShape logs keys + size, never values", () => {
  const out = redactBodyShape({ event: "message", sender: "+61400000000", text: "hello" });
  // must NOT contain the PII values
  assertEquals(out.includes("+61400000000"), false);
  assertEquals(out.includes("hello"), false);
  // must contain the keys for debuggability
  assertEquals(out.includes("event"), true);
  assertEquals(out.includes("sender"), true);
});
