// Headless authenticated login to the live BFD app (magiclink + TOTP).
//
// Committed deliberately: this was rebuilt from scratch in three separate sessions because the
// scratchpad is per-session. Keep it here so the next session runs it instead of rediscovering it.
//
// USAGE
//   node auth.mjs                      # arms, waits for a code, saves storageState.json beside itself
//   node auth.mjs /path/to/scratch     # same, but keep state + code file in that dir
//   then, from any other terminal:     echo 123456 > <dir>/totp.txt
//
// WHAT IS ACTUALLY TRUE ABOUT THE TWO CLOCKS (measured 2026-08-13, supersedes earlier guesses):
//   * The Supabase MFA challenge TTL is 300s. It is NOT shorter than the code, and it is NOT
//     "a few seconds". Read it yourself: the /challenge response carries `expires_at`.
//   * A page reload mints a BRAND NEW challenge, so the screen can be parked indefinitely.
//   * Therefore: do the slow work up front (browser, magiclink, session, warm page), and on code
//     arrival reload to get a ~1s-old challenge, then type. About 2s of work after the code lands.
//   * A stale challenge reports `mfa_challenge_expired`. A code the server does not accept reports
//     `mfa_verification_failed`. These are DIFFERENT failures — read the body before theorising.
//
// TRAPS THAT COST REAL TIME
//   * The MFA field is `#mfa_login_code`. Do NOT use getByRole('textbox').first(): the login form
//     renders before the MFA form swaps in, so you type the code into the EMAIL box, the submit
//     button never enables (it is gated on mfaCode.length >= 6), and the click times out after 30s
//     while looking like a challenge problem.
//   * Use a locator's pressSequentially. Playwright fill() does not trip React onChange.
//   * A magiclink alone is aal1. Only TOTP elevates to aal2, and agency routes bounce below that.
//     Decode the JWT and require aal2, then load a real agency route, before trusting the state.
//   * Server side does NOT care: assert-client-access.ts never inspects aal. The aal2 requirement
//     is enforced only in the browser (App.tsx `mfaRequired`).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] || HERE;
const CODE_FILE = path.join(DIR, 'totp.txt');
const STATE_FILE = path.join(DIR, 'storageState.json');
const CHROME = process.env.CHROME_PATH
  || '/home/brendan/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const APP = process.env.BFD_APP_URL || 'https://app.buildingflowdigital.com';
const CLIENT_ID = process.env.BFD_CLIENT_ID_UI || 'e467dabc-57ee-416c-8831-83ecd9c7c925';
const EMAIL = process.env.BFD_AGENCY_EMAIL || 'brendan@buildingflowdigital.com';

const env = Object.fromEntries(
  fs.readFileSync(path.join(HERE, '../../.env'), 'utf8')
    .split('\n').filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readCode = () => {
  if (!fs.existsSync(CODE_FILE)) return null;
  const m = fs.readFileSync(CODE_FILE, 'utf8').match(/\d{6}/);
  return m ? m[0] : null;
};

const main = async () => {
  if (fs.existsSync(CODE_FILE)) fs.unlinkSync(CODE_FILE);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let lastVerify = null, challengeAt = 0;
  page.on('response', async r => {
    const u = r.url();
    if (!u.includes('/auth/v1/')) return;
    if (u.includes('/challenge')) challengeAt = Date.now();
    if (u.includes('/verify')) {
      let body = ''; try { body = (await r.text()).slice(0, 160); } catch { /* body already consumed */ }
      lastVerify = { status: r.status(), body };
    }
  });

  const gen = await (await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: `${APP}/` } }),
  })).json();
  if (!gen.action_link) { log('generate_link FAILED', JSON.stringify(gen).slice(0, 200)); await browser.close(); process.exit(3); }

  await page.goto(gen.action_link, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const field = page.locator('#mfa_login_code');
  await field.waitFor({ state: 'visible', timeout: 25000 });
  log(`ARMED. Send a code with:  echo 123456 > ${CODE_FILE}`);

  const tokenKey = `sb-${new URL(env.SUPABASE_URL).host.split('.')[0]}-auth-token`;
  const getClaims = async () => {
    const raw = await page.evaluate(k => window.localStorage.getItem(k), tokenKey).catch(() => null);
    if (!raw) return null;
    try {
      let s = raw; if (s.startsWith('base64-')) s = Buffer.from(s.slice(7), 'base64').toString();
      return JSON.parse(Buffer.from(JSON.parse(s).access_token.split('.')[1], 'base64').toString());
    } catch { return null; }
  };

  const deadline = Date.now() + 90 * 60 * 1000;
  let attempt = 0, elevated = false;
  while (Date.now() < deadline && !elevated) {
    const code = readCode();
    if (!code) { await new Promise(r => setTimeout(r, 150)); continue; }
    attempt++;
    fs.unlinkSync(CODE_FILE);
    lastVerify = null;

    const t = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });   // fresh challenge
    await field.waitFor({ state: 'visible', timeout: 20000 });
    await field.click();
    await field.pressSequentially(code, { delay: 20 });
    if (await field.inputValue() !== code) { log(`attempt ${attempt}: field mismatch`); continue; }

    const btn = page.locator('button[type="submit"]').first();
    for (let i = 0; i < 20 && await btn.isDisabled(); i++) await new Promise(r => setTimeout(r, 50));
    if (await btn.isDisabled()) { log(`attempt ${attempt}: submit disabled`); continue; }
    await btn.click({ timeout: 8000 });
    log(`attempt ${attempt}: submitted ${((Date.now() - t) / 1000).toFixed(1)}s after arrival, challenge age ${((Date.now() - challengeAt) / 1000).toFixed(1)}s`);

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300));
      const c = await getClaims();
      if (c && c.aal === 'aal2') { elevated = true; break; }
      if (lastVerify && lastVerify.status >= 400) break;
    }
    if (elevated) break;
    log(`attempt ${attempt}: REJECTED -> ${lastVerify ? lastVerify.status + ' ' + lastVerify.body : 'no verify response seen'}`);
    log('>>> send another code, still armed <<<');
  }

  if (!elevated) { log('GAVE UP without aal2'); await browser.close(); process.exit(5); }
  log('aal2 CONFIRMED');

  await page.goto(`${APP}/client/${CLIENT_ID}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3500));
  if (/\/auth|\/login/.test(page.url())) { log('BOUNCED to', page.url(), '- not saving'); await browser.close(); process.exit(6); }
  log('agency route holds:', page.url());

  fs.writeFileSync(STATE_FILE, JSON.stringify(await context.storageState(), null, 2));
  await browser.close();
  log('LOGIN OK — saved', STATE_FILE);
};
main().catch(e => { log('FATAL', e.message.slice(0, 250)); process.exit(1); });
