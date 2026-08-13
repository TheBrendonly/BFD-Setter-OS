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
- **USE `auth.mjs` IN THIS DIRECTORY.** It is committed precisely so nobody rebuilds it a fourth time.
  `node auth.mjs [scratchdir]` arms and waits; `echo 123456 > <scratchdir>/totp.txt` fires a code at it;
  it retries indefinitely, so a rejected code costs nothing but the code.
- **The two clocks, MEASURED 2026-08-13 (this supersedes the 2026-08-13 guess, which was wrong).**
  The earlier note here claimed the MFA challenge had an "apparently SHORTER" expiry than the code and
  that you must never pre-navigate. Both halves were wrong, and acting on them produced a design that
  fails every time. What is actually true:
  - **Challenge TTL is 300 seconds.** Don't guess it: the `/factors/{id}/challenge` response carries
    `expires_at`. It is far longer than a TOTP code's life, not shorter.
  - **A page reload mints a brand new challenge**, so the MFA screen can be parked indefinitely.
  - **The two failures are distinguishable, so read the body before theorising.** A dead challenge is
    `mfa_challenge_expired`; a code the server won't accept is `mfa_verification_failed`. The 2026-08-13
    `mfa_challenge_expired` sighting was real but self-inflicted: the browser sat on one challenge for
    more than five minutes.
  - **Correct design:** do the slow work up front (launch, `generate_link`, navigate, warm the page),
    then on code arrival `page.reload()` for a ~1s-old challenge and type immediately. ~2s total.
- **UNRESOLVED as of 2026-08-13 — do not assume the login works.** With challenge age 0.6s and the code
  submitted 1.9s after it was typed into the file by hand from a terminal (zero chat latency), Supabase
  still returned `mfa_verification_failed`. That is 5 failures on 2026-08-13 on top of 6 on 2026-08-12/13,
  **all of them `mfa_verification_failed`**, under every timing condition. Timing is therefore ruled out
  and the remaining candidates are authenticator clock drift, Brendan reading a different entry in his
  authenticator, or a stored secret that no longer matches the device. **The decisive next test is for
  Brendan to log into the app manually in his own browser**: if that also fails the factor is desynced
  and needs re-enrolling; if it succeeds the fault is in the automation. Reading `auth.mfa_factors.secret`
  to generate codes locally is blocked by the permission classifier, correctly, and should not be
  worked around.
- **`#mfa_login_code` is the field id — use it.** `getByRole('textbox').first()` grabs the EMAIL input on
  the login form that renders before the MFA form swaps in. The code then goes into the wrong box, the
  submit button never enables (it is gated on `mfaCode.length >= 6`), and the click sits for its full 30s
  timeout, which reads like a challenge problem and is not one. This cost an hour on 2026-08-13.
- **Server side does not enforce aal2 at all.** `_shared/assert-client-access.ts` never inspects `aal`; it
  checks JWT signature, `user_roles.role` and tenancy. The aal2 requirement is purely client-side
  (`App.tsx` bounces on `mfaRequired`). So the MFA wall only blocks *browser UI* verification; anything
  driven through an edge function needs a user JWT but not an elevated one.
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

- **UPDATE 2026-08-13 12:53 AEST, relayed via Cowork — the account is confirmed fine.** Brendan manually logged into `app.buildingflowdigital.com` in his own browser with a code and it worked, first try. That resolves the open question directly above: the factor is NOT desynced, do not re-enrol it. The remaining unknown is a narrower one — why the headless path rejects a code that the same authenticator, same secret, produces successfully in a normal browser. Next run should diff cookie/session state, network path, and browser fingerprint between the two if `auth.mjs` still fails after this update.

## Key IDs
- BFD client `e467dabc-57ee-416c-8831-83ecd9c7c925`; Twilio/retell_phone_1 `+61481614530`;
  Main Outbound setter `b09624b5-…` (agent `agent_b2f6495…`, shared inbound+outbound); TEST_PHONE_A
  `+61405482446` (free-use, but a KNOWN CRM lead); Supabase ref `bjgrgbgykvjrsuwwruoh`.
