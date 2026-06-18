import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPhoneOptedOut } from "./optout.ts";

function fakeSb(row: any) {
  const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: row, error: null }) };
  return { from: () => b };
}

Deno.test("opted out when a row exists", async () => {
  assertEquals(await isPhoneOptedOut(fakeSb({ phone: "+61405482446" }) as any, "c", "+61405482446"), true);
});

Deno.test("not opted out when none and when phone null", async () => {
  assertEquals(await isPhoneOptedOut(fakeSb(null) as any, "c", "+61405482446"), false);
  assertEquals(await isPhoneOptedOut(fakeSb(null) as any, "c", ""), false);
});
