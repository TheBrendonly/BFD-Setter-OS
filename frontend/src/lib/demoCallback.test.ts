import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestDemoCallback, validateLocally } from './demoCallback.ts';

const CONFIG = { endpoint: 'https://example.test/functions/v1/demo-callback', anonKey: 'anon' };

const REQUEST = {
  slug: 'stapleton-finance',
  firstName: 'Brendan',
  email: 'brendan@example.com',
  phone: '0405482446',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── local validation ──

test('accepts a well-formed submission', () => {
  assert.equal(validateLocally(REQUEST), null);
});

test('accepts an E.164 mobile with spaces', () => {
  assert.equal(validateLocally({ ...REQUEST, phone: '+61 405 482 446' }), null);
});

test('rejects a blank name', () => {
  assert.match(String(validateLocally({ ...REQUEST, firstName: '  ' })), /first name/i);
});

test('rejects a malformed email', () => {
  assert.match(String(validateLocally({ ...REQUEST, email: 'nope' })), /email/i);
});

test('rejects a landline and a non-AU number', () => {
  assert.match(String(validateLocally({ ...REQUEST, phone: '0299999999' })), /mobile/i);
  assert.match(String(validateLocally({ ...REQUEST, phone: '+14155550123' })), /mobile/i);
});

// ── request ──

test('posts the snake_case payload the edge function expects', async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const result = await requestDemoCallback(REQUEST, CONFIG, (url, init) => {
    captured = { url, init };
    return Promise.resolve(jsonResponse({ ok: true }));
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(captured!.url, CONFIG.endpoint);
  const body = JSON.parse(String(captured!.init?.body));
  assert.deepEqual(body, {
    slug: 'stapleton-finance',
    first_name: 'Brendan',
    email: 'brendan@example.com',
    phone: '0405482446',
  });
});

test('surfaces the server error message verbatim', async () => {
  const result = await requestDemoCallback(REQUEST, CONFIG, () =>
    Promise.resolve(jsonResponse({ error: "We've already called that number recently." }, 429)));
  assert.deepEqual(result, {
    ok: false,
    error: "We've already called that number recently.",
  });
});

test('falls back to a generic message when the error body is unusable', async () => {
  const result = await requestDemoCallback(REQUEST, CONFIG, () =>
    Promise.resolve(new Response('<html>502</html>', { status: 502 })));
  assert.equal(result.ok, false);
  assert.match(String((result as { error: string }).error), /something went wrong/i);
});

test('treats a 200 without ok:true as a failure', async () => {
  const result = await requestDemoCallback(REQUEST, CONFIG, () =>
    Promise.resolve(jsonResponse({ queued: 'maybe' })));
  assert.equal(result.ok, false);
});

test('reports a network failure without throwing', async () => {
  const result = await requestDemoCallback(REQUEST, CONFIG, () =>
    Promise.reject(new Error('offline')));
  assert.equal(result.ok, false);
  assert.match(String((result as { error: string }).error), /network/i);
});
