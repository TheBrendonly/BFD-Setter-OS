import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findOrCreateGhlContact, GhlContactError } from "./ghlContact.ts";

const BASE_ARGS = {
  ghlApiKey: "test-key",
  ghlLocationId: "loc_1",
  firstName: "Brendan",
  email: "brendan@example.com",
  phone: "+61405482446",
  source: "bfd-demo:test",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Queues responses in order and records the requests made. */
function stubFetch(responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return Promise.resolve(next);
  };
  return { impl, calls };
}

Deno.test("returns an existing contact on an exact phone match", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ contacts: [{ id: "contact_1", phone: "+61405482446" }] }),
  ]);
  assertEquals(await findOrCreateGhlContact(BASE_ARGS, impl), "contact_1");
  // Matched on the first search, so no create call was made.
  assertEquals(calls.length, 1);
});

Deno.test("matches a stored phone that lacks the leading plus", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "contact_2", phone: "61405482446" }] }),
  ]);
  assertEquals(await findOrCreateGhlContact(BASE_ARGS, impl), "contact_2");
});

Deno.test("matches on email case-insensitively when phone misses", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "wrong", phone: "+61400000000" }] }),
    jsonResponse({ contacts: [{ id: "contact_3", email: "BRENDAN@example.com" }] }),
  ]);
  assertEquals(await findOrCreateGhlContact(BASE_ARGS, impl), "contact_3");
});

Deno.test("ignores a fuzzy near-match and creates instead", async () => {
  // GHL search is fuzzy: a contact whose number merely overlaps must NOT win,
  // or the booking attaches to the wrong person.
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "overlap", phone: "+61405482999" }] }),
    jsonResponse({ contacts: [{ id: "overlap", phone: "+61405482999" }] }),
    jsonResponse({ contact: { id: "created_1" } }, 201),
  ]);
  assertEquals(await findOrCreateGhlContact(BASE_ARGS, impl), "created_1");
});

Deno.test("treats a 400 carrying meta.contactId as found, not failed", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ message: "duplicate", meta: { contactId: "existing_9" } }, 400),
  ]);
  assertEquals(await findOrCreateGhlContact(BASE_ARGS, impl), "existing_9");
});

Deno.test("sends locationId, source and the demo tag on create", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ contact: { id: "created_2" } }, 201),
  ]);
  await findOrCreateGhlContact({ ...BASE_ARGS, tags: ["bfd-demo-callback"] }, impl);
  const createBody = JSON.parse(String(calls[2].init?.body));
  assertEquals(createBody.locationId, "loc_1");
  assertEquals(createBody.source, "bfd-demo:test");
  assertEquals(createBody.tags, ["bfd-demo-callback"]);
  assertEquals(createBody.phone, "+61405482446");
});

Deno.test("survives a failed search and still creates", async () => {
  const { impl } = stubFetch([
    jsonResponse({ error: "boom" }, 500),
    jsonResponse({ error: "boom" }, 500),
    jsonResponse({ contact: { id: "created_3" } }, 201),
  ]);
  assertEquals(await findOrCreateGhlContact(BASE_ARGS, impl), "created_3");
});

Deno.test("throws when create succeeds but returns no id", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ contact: {} }, 201),
  ]);
  await assertRejects(() => findOrCreateGhlContact(BASE_ARGS, impl), GhlContactError);
});

Deno.test("throws on a non-duplicate create failure", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ message: "unauthorized" }, 401),
  ]);
  await assertRejects(() => findOrCreateGhlContact(BASE_ARGS, impl), GhlContactError);
});
