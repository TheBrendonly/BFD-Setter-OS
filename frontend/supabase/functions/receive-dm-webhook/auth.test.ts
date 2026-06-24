import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dmWebhookRequiresSecret } from "./auth.ts";

// B3 (2026-06-24): receive-dm-webhook must fail CLOSED when a client has no
// ghl_webhook_secret (it used to skip auth and run every side-effect
// unauthenticated). Enforcement is ON by default; DM_WEBHOOK_REQUIRE_SECRET is
// a kill-switch. This locks the default-on + disable-value semantics.

Deno.test("unset env -> enforce (true)", () => {
  assertEquals(dmWebhookRequiresSecret(undefined), true);
});

Deno.test("empty string -> enforce (true)", () => {
  assertEquals(dmWebhookRequiresSecret(""), true);
});

Deno.test("explicit disable values -> do not enforce (false)", () => {
  for (const v of ["false", "0", "off", "FALSE", "Off", " false ", "no"]) {
    assertEquals(dmWebhookRequiresSecret(v), false, `expected ${JSON.stringify(v)} to disable`);
  }
});

Deno.test("enable / garbage values -> enforce (true)", () => {
  for (const v of ["true", "1", "on", "yes", "enforce", "x"]) {
    assertEquals(dmWebhookRequiresSecret(v), true, `expected ${JSON.stringify(v)} to enforce`);
  }
});
