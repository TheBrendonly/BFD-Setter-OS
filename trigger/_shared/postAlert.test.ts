import { test } from "node:test";
import assert from "node:assert/strict";
import { postAlert } from "./postAlert.ts";

const origFetch = globalThis.fetch;
const origUrl = process.env.PROBE_ALERT_WEBHOOK_URL;

function stubFetch() {
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true } as Response;
  }) as typeof fetch;
  return calls;
}
function restore() {
  globalThis.fetch = origFetch;
  if (origUrl === undefined) delete process.env.PROBE_ALERT_WEBHOOK_URL;
  else process.env.PROBE_ALERT_WEBHOOK_URL = origUrl;
}

test("no-op when the env var is unset", async () => {
  delete process.env.PROBE_ALERT_WEBHOOK_URL;
  const calls = stubFetch();
  assert.equal(await postAlert("hi"), false);
  assert.equal(calls.length, 0);
  restore();
});

test("Telegram URL -> {chat_id, message_thread_id, text} to the clean endpoint", async () => {
  process.env.PROBE_ALERT_WEBHOOK_URL =
    "https://api.telegram.org/bot123:ABC/sendMessage?chat_id=5119702648&message_thread_id=2930";
  const calls = stubFetch();
  const ok = await postAlert("probe FAIL", "detail line");
  assert.equal(ok, true);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123:ABC/sendMessage");
  assert.equal(calls[0].body.chat_id, "5119702648");
  assert.equal(calls[0].body.message_thread_id, 2930);
  assert.equal(calls[0].body.text, "probe FAIL\n\ndetail line");
  restore();
});

test("non-Telegram URL -> Slack {text, attachments} shape, URL unchanged", async () => {
  process.env.PROBE_ALERT_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/X";
  const calls = stubFetch();
  await postAlert("title", "body");
  assert.equal(calls[0].url, "https://hooks.slack.com/services/T/B/X");
  assert.equal(calls[0].body.text, "title");
  assert.equal(calls[0].body.attachments[0].text, "body");
  restore();
});
