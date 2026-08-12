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
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "contact_1");
  // Matched on the first search, so no create call was made.
  assertEquals(calls.length, 1);
});

Deno.test("matches a stored phone that lacks the leading plus", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "contact_2", phone: "61405482446" }] }),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "contact_2");
});

Deno.test("matches on email case-insensitively when phone misses", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "wrong", phone: "+61400000000" }] }),
    jsonResponse({ contacts: [{ id: "contact_3", email: "BRENDAN@example.com" }] }),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "contact_3");
});

Deno.test("ignores a fuzzy near-match and creates instead", async () => {
  // GHL search is fuzzy: a contact whose number merely overlaps must NOT win,
  // or the booking attaches to the wrong person.
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "overlap", phone: "+61405482999" }] }),
    jsonResponse({ contacts: [{ id: "overlap", phone: "+61405482999" }] }),
    jsonResponse({ contact: { id: "created_1" } }, 201),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "created_1");
});

Deno.test("treats a 400 carrying meta.contactId as found, not failed", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ message: "duplicate", meta: { contactId: "existing_9" } }, 400),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "existing_9");
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
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "created_3");
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

// ── Consolidation cases (2026-08-12) ─────────────────────────────────────────
// Added when the three private copies merged. Each locks one behaviour that
// differed between call sites, so a future "simplification" cannot quietly
// change what one of them does.

Deno.test("multiMatch 'first' keeps GHL's order (intake-lead, demo-callback)", async () => {
  const { impl } = stubFetch([
    jsonResponse({
      contacts: [
        { id: "older", phone: "+61405482446", dateUpdated: "2020-01-01T00:00:00Z" },
        { id: "newer", phone: "+61405482446", dateUpdated: "2026-01-01T00:00:00Z" },
      ],
    }),
  ]);
  const r = await findOrCreateGhlContact(BASE_ARGS, impl);
  assertEquals(r.contactId, "older");
  assertEquals(r.outcome, "found");
});

Deno.test("multiMatch 'mostRecent' picks the last-updated contact (receive-twilio-sms)", async () => {
  // Mirrors _shared/leadResolve.ts so the GHL fallback and the internal resolver
  // agree on who owns a shared number.
  const { impl } = stubFetch([
    jsonResponse({
      contacts: [
        { id: "older", phone: "+61405482446", dateUpdated: "2020-01-01T00:00:00Z" },
        { id: "newer", phone: "+61405482446", dateUpdated: "2026-01-01T00:00:00Z" },
      ],
    }),
  ]);
  const r = await findOrCreateGhlContact({ ...BASE_ARGS, multiMatch: "mostRecent" }, impl);
  assertEquals(r.contactId, "newer");
});

Deno.test("multiMatch 'mostRecent' tie-breaks by dateAdded, then id, deterministically", async () => {
  const same = "2026-01-01T00:00:00Z";
  const { impl } = stubFetch([
    jsonResponse({
      contacts: [
        { id: "aaa", phone: "+61405482446", dateUpdated: same, dateAdded: same },
        { id: "zzz", phone: "+61405482446", dateUpdated: same, dateAdded: same },
      ],
    }),
  ]);
  const r = await findOrCreateGhlContact({ ...BASE_ARGS, multiMatch: "mostRecent" }, impl);
  assertEquals(r.contactId, "zzz");
});

Deno.test("lastName is sent on create only when supplied (intake-lead sends one)", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ contact: { id: "created_x" } }, 201),
  ]);
  await findOrCreateGhlContact({ ...BASE_ARGS, lastName: "Green" }, impl);
  const body = JSON.parse(String(calls[2].init?.body));
  assertEquals(body.lastName, "Green");
  assertEquals(body.firstName, "Brendan");

  const { impl: impl2, calls: calls2 } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ contact: { id: "created_y" } }, 201),
  ]);
  await findOrCreateGhlContact(BASE_ARGS, impl2);
  assertEquals("lastName" in JSON.parse(String(calls2[2].init?.body)), false);
});

Deno.test("a found contact reports its display name and email", async () => {
  // receive-twilio-sms needs both; the other two ignore them.
  const { impl } = stubFetch([
    jsonResponse({
      contacts: [{
        id: "c1",
        phone: "+61405482446",
        firstName: "Bren",
        lastName: "Green",
        email: "bren@example.com",
      }],
    }),
  ]);
  const r = await findOrCreateGhlContact(BASE_ARGS, impl);
  assertEquals(r.name, "Bren Green");
  assertEquals(r.email, "bren@example.com");
});

Deno.test("display name falls back to contactName, then empty", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [{ id: "c1", phone: "+61405482446", contactName: "SMS Lead" }] }),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).name, "SMS Lead");

  const { impl: impl2 } = stubFetch([
    jsonResponse({ contacts: [{ id: "c2", phone: "+61405482446" }] }),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl2)).name, "");
});

Deno.test("the duplicate path surfaces meta.contactName so callers can label it", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse(
      { statusCode: 400, message: "duplicated contacts", meta: { contactId: "dup_1", contactName: "Existing Person" } },
      400,
    ),
  ]);
  const r = await findOrCreateGhlContact(BASE_ARGS, impl);
  assertEquals(r.contactId, "dup_1");
  assertEquals(r.name, "Existing Person");
  assertEquals(r.outcome, "duplicate");
});

Deno.test("outcome distinguishes found / created / duplicate", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [] }),
    jsonResponse({ contact: { id: "new_1" } }, 201),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).outcome, "created");
});

Deno.test("email match tolerates surrounding whitespace on the stored value", async () => {
  const { impl } = stubFetch([
    jsonResponse({ contacts: [] }),
    jsonResponse({ contacts: [{ id: "c9", email: "  Brendan@Example.com " }] }),
  ]);
  assertEquals((await findOrCreateGhlContact(BASE_ARGS, impl)).contactId, "c9");
});

Deno.test("phone-only callers never issue an email search (receive-twilio-sms)", async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ contacts: [{ id: "c1", phone: "+61405482446" }] }),
  ]);
  await findOrCreateGhlContact(
    { ...BASE_ARGS, email: null, multiMatch: "mostRecent" },
    impl,
  );
  assertEquals(calls.length, 1);
});
