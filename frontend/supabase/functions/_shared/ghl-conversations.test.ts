import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeGhlContactFields } from "./ghl-conversations.ts";

type FetchCall = { url: string; init: RequestInit };

// Install a fetch stub that records calls and returns a scripted Response.
function stubFetch(
  responder: () => Response | Promise<Response>,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(responder());
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("writeGhlContactFields: no valid fields → skipped, no network call", async () => {
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const res = await writeGhlContactFields({
      ghlApiKey: "key",
      contactId: "c1",
      fields: [
        { id: "", value: "x" },
        { id: "f1", value: "" },
      ],
    });
    assertEquals(res, { ok: true, skipped: true });
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test("writeGhlContactFields: single PUT for N valid fields, field_value keyed, drops empties", async () => {
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const res = await writeGhlContactFields({
      ghlApiKey: "key",
      contactId: "c1",
      fields: [
        { id: "f1", value: "Positive" },
        { id: "", value: "drop-me" },
        { id: "f2", value: "true" },
      ],
    });
    assertEquals(res.ok, true);
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, "https://services.leadconnectorhq.com/contacts/c1");
    assertEquals(calls[0].init.method, "PUT");
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers.Version, "2021-07-28");
    assertEquals(headers.Authorization, "Bearer key");
    const body = JSON.parse(String(calls[0].init.body));
    assertEquals(body, { customFields: [{ id: "f1", field_value: "Positive" }, { id: "f2", field_value: "true" }] });
  } finally {
    restore();
  }
});

Deno.test("writeGhlContactFields: non-2xx → ok:false with status, does not throw", async () => {
  const { restore } = stubFetch(() => new Response("nope", { status: 422 }));
  try {
    const res = await writeGhlContactFields({
      ghlApiKey: "key",
      contactId: "c1",
      fields: [{ id: "f1", value: "x" }],
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 422);
  } finally {
    restore();
  }
});

Deno.test("writeGhlContactFields: fetch throw → ok:false with error, does not throw", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    const res = await writeGhlContactFields({
      ghlApiKey: "key",
      contactId: "c1",
      fields: [{ id: "f1", value: "x" }],
    });
    assertEquals(res.ok, false);
    assertEquals(res.error, "network down");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("writeGhlContactFields: missing ghlApiKey/contactId → skipped, no network call", async () => {
  const { calls, restore } = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const res = await writeGhlContactFields({ ghlApiKey: "", contactId: "c1", fields: [{ id: "f1", value: "x" }] });
    assertEquals(res, { ok: true, skipped: true });
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});
