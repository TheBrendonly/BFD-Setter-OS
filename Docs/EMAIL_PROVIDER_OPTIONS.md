# Email Provider Options for Password Reset (Supabase Auth SMTP)

Written 2026-06-12. Decision needed from Brendan; wiring is a 10-minute Claude task once credentials exist.

## The problem

Supabase sends password-reset and verification emails through SMTP. Our project has NO custom SMTP configured. The built-in Supabase mailer works but is limited: it only delivers to project TEAM MEMBERS (so brendan@buildingflowdigital.com works, sub-account users do not), is rate-limited to a couple of emails per hour, and has no delivery guarantee. Fine for you alone today; not fine for clients.

Note: our reset flow is currently agency-only by design (the `check-reset-eligibility` function blocks client-role resets), so the built-in mailer covers 100% of today's real usage. A provider becomes necessary when sub-account users should self-reset, or for reliability.

## How any option plugs in

1. Create an account with the provider, verify the buildingflowdigital.com domain (a few DNS records: SPF + DKIM), get SMTP credentials or an API key.
2. Claude PATCHes the Supabase auth config (host, port, username, password, sender address no-reply@buildingflowdigital.com).
3. Done. Supabase then sends all auth emails through it. Default cap after enabling: 30 emails/hour (raisable in config).

## Options (free first)

### 1. Keep the built-in Supabase mailer (free, zero setup): fine for now

- Works today for YOUR resets once the Site URL fix is live. No accounts, no DNS.
- Limits: team members only, ~2-4 emails/hour, best-effort delivery, not for production clients.
- Verdict: acceptable interim while only the agency account resets passwords.

### 2. Resend (recommended when we outgrow built-in)

- Free tier: 3,000 emails/month, permanent. Easiest setup of all providers: username is the fixed string "resend", password is an API key. Excellent docs, made for this exact use case.
- Needs: account + domain verification (2 DNS records).
- Verdict: best balance of free allowance and simplicity. The default pick.

### 3. Brevo (biggest free allowance)

- Free tier: 300 emails/day (~9,000/month), permanent. SMTP key generated in their dashboard; slightly clunkier UI than Resend.
- Verdict: pick if email volume ever matters more than setup polish.

### 4. Google Workspace SMTP (free with the existing account)

- Uses smtp.gmail.com with an app password on brendan@buildingflowdigital.com (requires 2FA on the Google account).
- Limits: ~500-2,000/day cap, Google can throttle automated mail, mixes auth mail into your personal sending reputation.
- Verdict: workable zero-new-accounts option, but app-password setup is fiddlier than Resend and less clean long-term.

### 5. AWS SES (cheapest at scale, most friction)

- 3,000 emails/month free for the FIRST 12 MONTHS only, then ~$0.10 per 1,000. Setup needs IAM users, DKIM, and a sandbox-exit request.
- Verdict: only worth it at serious volume. Not now.

### Not recommended

- SendGrid: free tier is now a 60-day trial only.
- Postmark: 100 emails/month free (too small).
- ZeptoMail: one-time credits that expire.

## Recommendation

Short term: do nothing (built-in mailer + Site URL fix already cover agency resets). When ready, 15 minutes of Brendan time: create a Resend account, verify the domain, hand Claude the API key. Claude wires it the same day.

Sources: Supabase custom SMTP docs (https://supabase.com/docs/guides/auth/auth-smtp), codenote.net Supabase SMTP comparison (2026), Resend pricing page.
