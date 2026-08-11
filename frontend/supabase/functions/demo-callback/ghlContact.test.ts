import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addContactTags,
  findOrCreateGhlContact,
  GhlContactError,
  updateContactEmail,
} from "./ghlContact.ts";

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

Deno.test("create-failure error message carries the status but never the PII-echoing body", async () => {
  // SEC-PII-LOGS-1: GHL error payloads echo submitted phone/email; the thrown
  // message reaches console.error via the handler's catch-all.
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ message: "bad", phone: "+61405482446", email: "brendan@example.com" }, 422),
  ]);
  try {
    await findOrCreateGhlContact(BASE_ARGS, impl);
    throw new Error("expected throw");
  } catch (err) {
    const message = (err as Error).message;
    assertEquals(message.includes("422"), true);
    assertEquals(message.includes("+61405482446"), false);
    assertEquals(message.includes("brendan@example.com"), false);
  }
});

// ── addContactTags ──

Deno.test("addContactTags POSTs to the append-only tags endpoint", async () => {
  const { impl, calls } = stubFetch([jsonResponse({ succeeded: true })]);
  const ok = await addContactTags(
    { ghlApiKey: "k", contactId: "contact_1", tags: ["bfd-demo-callback"] },
    impl,
  );
  assertEquals(ok, true);
  assertEquals(calls[0].url, "https://services.leadconnectorhq.com/contacts/contact_1/tags");
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(JSON.parse(String(calls[0].init?.body)), { tags: ["bfd-demo-callback"] });
});

Deno.test("addContactTags reports failure without throwing", async () => {
  const { impl } = stubFetch([jsonResponse({ error: "nope" }, 401)]);
  assertEquals(await addContactTags({ ghlApiKey: "k", contactId: "c", tags: ["t"] }, impl), false);
  const throwing = () => Promise.reject(new Error("offline"));
  assertEquals(await addContactTags({ ghlApiKey: "k", contactId: "c", tags: ["t"] }, throwing), false);
});

// ── updateContactEmail ──

Deno.test("updateContactEmail PUTs only the email field", async () => {
  const { impl, calls } = stubFetch([jsonResponse({ contact: { id: "contact_1" } })]);
  const ok = await updateContactEmail(
    { ghlApiKey: "k", contactId: "contact_1", email: "new@example.com" },
    impl,
  );
  assertEquals(ok, true);
  assertEquals(calls[0].url, "https://services.leadconnectorhq.com/contacts/contact_1");
  assertEquals(calls[0].init?.method, "PUT");
  assertEquals(JSON.parse(String(calls[0].init?.body)), { email: "new@example.com" });
});

Deno.test("updateContactEmail reports failure without throwing", async () => {
  const { impl } = stubFetch([jsonResponse({ error: "nope" }, 500)]);
  assertEquals(
    await updateContactEmail({ ghlApiKey: "k", contactId: "c", email: "a@b.co" }, impl),
    false,
  );
});
