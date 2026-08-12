# Test Harness (autonomous live-testing helpers)

Built during the 2026-07-05 TEST SESSION so Claude can drive live verification without a human for
most flows. All scripts read creds from the repo `./.env` at runtime (nothing hardcoded). Run from this
dir with `node <script>.mjs`. Deps: `playwright-core` (installed on demand in a scratchpad; browser
binary is the OS-cached Chromium at `~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`).

## What each does

- **`q.mjs "SQL"`** — run SQL against the PLATFORM Supabase via the Management API `/database/query`
  (browser UA, `SUPABASE_PAT`). This is how you read/write platform tables. NOT the postgres MCP.
- **`ext_tables.mjs`** — introspect a client's EXTERNAL Supabase (reads `supabase_url`+`service_key` from
  the client row in-memory, never prints the key); lists tables. BFD external chat table = `chat_history`.
- **`sms_inbound.mjs "Body"`** — simulate a Twilio inbound SMS end-to-end. Computes a valid
  `X-Twilio-Signature` = base64(HMAC-SHA1(`{SUPABASE_URL}/functions/v1/receive-twilio-sms` + sorted
  k+v, `clients.twilio_auth_token`)) and POSTs the form to the webhook. Routes by `retell_phone_1 == To`.
  The native engine processes it (debounce 25s) and REPLIES via the live Twilio account to `From`
  (default `+61405482446` = TEST_PHONE_A). Use for booking / SMS-MEM-1 / SMS-OBS-1 / STOP / by-phone.
- **`dial.mjs [voice_setter_id] [phone] [vm]`** — place a real outbound Retell call via
  `make-retell-outbound-call`. AUTH = the **service-role key as Bearer** (the server-to-server fast path in
  `_shared/authorize-client-request.ts`; a user JWT is REJECTED here). Pass `vm` to include a
  `voicemail_config`. Main Outbound setter id = `b09624b5-5169-495a-bedd-fb6d3004ab34`.

## Techniques (recreate as needed)

### Headless authenticated browser (Playwright)
- Install `playwright-core` in a scratch dir with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (browser is cached).
- Login WITHOUT a password: admin `POST {SUPABASE_URL}/auth/v1/admin/generate_link {type:"magiclink",email}`
  (service key; NO email is sent), navigate the returned `action_link`. **The account has 2FA (TOTP)** — the
  app then demands a 6-digit code, so ask Brendan for ONE code, fill it, and save `context.storageState()`
  to `storageState.json`. Reuse that state for all subsequent headless runs.
- **TWO CLOCKS, not one (found the hard way 2026-08-12/13, six burned codes before this was understood).**
  A TOTP code is valid ~30-90s. Separately, Supabase creates an MFA **challenge** server-side the moment
  the magiclink is consumed and the app reaches the "enter your code" screen — and that challenge has its
  OWN, apparently SHORTER expiry, independent of whether the code you type is valid. Evidence: the auth
  response body differed between attempts — `422 mfa_verification_failed` (a real but stale code) on early
  tries, then `422 mfa_challenge_expired` (a dead challenge, unrelated to the code) once the browser had
  been pre-navigated to the MFA screen and left sitting there for a few minutes waiting on a code, even
  though that code was typed within ~1s of arriving. **Do not pre-navigate and then wait.** Instead: launch
  the browser ahead of time (safe — starts neither clock), poll for the code with the browser idle on
  `about:blank`, and only once the code exists do `generate_link` → `page.goto` → type → submit, all
  back-to-back with no waits in between, so both clocks start together right before they're needed.
- Access token expires ~1h; refresh via `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`
  with `apikey = VITE_SUPABASE_ANON_KEY` (from `frontend/.env`) and the stored `refresh_token`. Simpler:
  just re-drive through the browser, which refreshes auth itself.
- **React controlled inputs**: Playwright `fill()` does NOT trip React `onChange`. Use a Playwright
  **locator** (`page.locator(...).pressSequentially(code, {delay: 20})`, real trusted key events) rather
  than setting `.value` via the native setter in `page.evaluate` — both approaches fill the field visibly,
  but only the locator's real events reliably enable React-gated buttons downstream.
- **The submit button needs a real Playwright click, not a synthetic one.** A `btn.click()` called from
  inside `page.evaluate()` silently failed here: the code appeared in the field, no error rendered, the
  form just never submitted — because the button is gated on field validity and can still read as
  disabled at the moment of the synthetic call. Use `page.getByRole('button', {name: /verify/i}).click()`,
  and wait for `!button.disabled` first if the gating is asynchronous.
- **A session token existing is not proof you're authenticated at the right level.** A magiclink alone
  yields an MFA-unelevated session (`aal1` in the decoded JWT); completing TOTP is what upgrades it to
  `aal2`, and agency routes bounce to `/auth` on anything less. The `aal1` token looks completely healthy
  (right shape, not expired), so checking only "does a token exist" will save a session that silently
  can't reach any protected route. Decode the JWT and require `aal2`, then prove it by loading one real
  agency route and confirming it does NOT redirect, before trusting `storageState()` enough to save it.
- Agency routes are under `/client/<clientId>/…` — e.g. `/prompts/voice`, `/prompts/text` (NOT
  `/prompt-management`), `/settings` (ClientSettings, F8/F13 editor, voicemail card),
  `/analytics/chatbot/dashboard`, `/account-settings`, `/leads`.

### Cleanups
- Cancel a GHL appointment: `PUT https://services.leadconnectorhq.com/calendars/events/appointments/{id}`
  `{appointmentStatus:"cancelled"}` with `Version: 2021-04-15` + the client `ghl_api_key`. Mirror the
  `bookings` row to `status='cancelled'`.
- GHL-outage sim: capture the real `ghl_api_key` in-memory, set a bad value, fire the inbound, RESTORE in a
  `finally`. This overwrites a live secret — get Brendan's explicit OK first (the auto-mode classifier blocks
  it otherwise) and keep the window short.

## Key IDs
- BFD client `e467dabc-57ee-416c-8831-83ecd9c7c925`; Twilio/retell_phone_1 `+61481614530`;
  Main Outbound setter `b09624b5-…` (agent `agent_b2f6495…`, shared inbound+outbound); TEST_PHONE_A
  `+61405482446` (free-use, but a KNOWN CRM lead); Supabase ref `bjgrgbgykvjrsuwwruoh`.
