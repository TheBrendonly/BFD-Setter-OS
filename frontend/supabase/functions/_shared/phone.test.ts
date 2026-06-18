import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizePhone } from "./phone.ts";

Deno.test("AU national mobile -> E.164", () => {
  assertEquals(normalizePhone("0405 482 446"), "+61405482446");
  assertEquals(normalizePhone("0405482446"), "+61405482446");
});
Deno.test("already E.164 is preserved", () => {
  assertEquals(normalizePhone("+61405482446"), "+61405482446");
  assertEquals(normalizePhone("+61 405 482 446"), "+61405482446");
});
Deno.test("formatting chars stripped", () => {
  assertEquals(normalizePhone("(04) 0548-2446"), "+61405482446");
});
Deno.test("international + preserved (non-AU)", () => {
  assertEquals(normalizePhone("+14155552671"), "+14155552671");
});
Deno.test("unparseable -> null", () => {
  assertEquals(normalizePhone(""), null);
  assertEquals(normalizePhone(null), null);
  assertEquals(normalizePhone("abc"), null);
  assertEquals(normalizePhone("12"), null);
});
