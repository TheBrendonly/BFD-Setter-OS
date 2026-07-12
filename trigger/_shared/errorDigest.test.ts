// F23 — errorDigest rollup tests.
//   node --experimental-strip-types --test trigger/_shared/errorDigest.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import { rollupErrors, formatDigestLine } from "./errorDigest.ts";

test("rollupErrors: groups per client then source, count-desc", () => {
  const rows = [
    { client_id: "c1", source: "make-retell-outbound-call" },
    { client_id: "c1", source: "make-retell-outbound-call" },
    { client_id: "c1", source: "receive-twilio-sms" },
    { client_id: "c2", source: "sync-ghl-booking" },
  ];
  const out = rollupErrors(rows);
  assert.equal(out.total, 4);
  assert.equal(out.clients.length, 2);
  // c1 has the most errors -> first
  assert.equal(out.clients[0].clientKey, "c1");
  assert.equal(out.clients[0].count, 3);
  assert.deepEqual(out.clients[0].sources, { "make-retell-outbound-call": 2, "receive-twilio-sms": 1 });
  assert.equal(out.clients[1].clientKey, "c2");
});

test("rollupErrors: falls back to ghl account id then 'unknown'", () => {
  const out = rollupErrors([
    { client_ghl_account_id: "loc123", source: "crm-send-message" },
    { source: null },
  ]);
  const keys = out.clients.map((c) => c.clientKey).sort();
  assert.deepEqual(keys, ["loc123", "unknown"]);
});

test("rollupErrors: empty input -> zero", () => {
  assert.deepEqual(rollupErrors([]), { total: 0, clients: [] });
});

test("formatDigestLine renders the source summary", () => {
  const line = formatDigestLine("Acme", { clientKey: "c1", count: 3, sources: { "make-retell-outbound-call": 2, "receive-twilio-sms": 1 } });
  assert.equal(line, "Acme: 3 error(s) — make-retell-outbound-call×2, receive-twilio-sms×1");
});
