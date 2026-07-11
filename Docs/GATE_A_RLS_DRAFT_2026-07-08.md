---
description: DRAFT (not applied) GATE A migration to role-gate the RLS cluster before the first client-role user - review + live-probe in a dedicated session, do NOT apply unattended.
---

# GATE A — RLS role-gate cluster (DRAFT, NOT APPLIED)

**Status: review draft. Do NOT apply unattended.** This is the starting point for the dedicated GATE A
session. It role-gates the tables the 2026-07-08 pass found ungated so that, once the first client-role
user exists, that user cannot read sibling clients' secrets/cost/config. High blast radius (`clients` has
79+ reads); each table below has an OPEN QUESTION that must be answered with a live client-role probe
BEFORE the migration is applied. Source findings: `Docs/SECURITY_REVIEW_2026-07-08.md`.

**Ordering:** apply only AFTER confirming every OPEN QUESTION. Run the live probe (throwaway client-role
user) after applying. `get_user_role` is already deterministic (ROLE-RESOLVE-1, shipped 2026-07-08).

---

> **⚠️ 2026-07-11 review finding (resolves part of §1's OPEN QUESTION):** the client-role-reachable pages
> `AccountSettings.tsx`, `AnalyticsLayout.tsx`, and `ClientDashboard.tsx` **UPDATE base `clients`** to persist
> UI state (`crm_filter_config`: sub-account column widths, `analytics_dashboard_order`, `last_analytics_dashboard`)
> under a client JWT (they READ via `clients_public` but WRITE the base table). So the §1 draft's blanket agency-only
> UPDATE gate would **silently break client UI-state saves** (wrapped in try/catch, so no crash — prefs just stop
> persisting). The migration MUST add a `client_own` UPDATE policy scoped to `client_id = get_user_client_id(...)`
> (mirroring the tenant-disjunction §4 shape) OR relocate those three writes to `clients_public`/an edge fn in the
> SAME change. Do the `rg` sweep for the remaining base-`clients` reads/writes before applying. (No client-role
> user exists today, so nothing is exposed yet — this is a correctness gate for the apply, not a live leak.)

## 1. `clients` (RLS-CLIENTS-1, Critical) — the hard one

Current live policies (roles `{public}`, NO role gate):
`Agency users can view their clients` (SELECT), `... update ...` (UPDATE), `... delete ...` (DELETE),
`... insert ...` (INSERT). Adding `get_user_role='agency'` removes ALL direct client-role reads of the
base table.

**OPEN QUESTION (must resolve first):** does any client-facing UI path or client-scoped edge function
read the BASE `clients` table under a client-role JWT (not via `clients_public`, not service-role)?
B5/S1-1 repointed 79 reads to `clients_public`, but confirm ZERO client-path base reads remain:
`rg -n "from\(['\"]clients['\"]" frontend/src` and check each hit is agency-only or repointed. If any
client read remains, repoint it to `clients_public` in the SAME change.

```sql
-- GATE A / RLS-CLIENTS-1: gate the base clients policies to agency role. Client-role users read via
-- clients_public (has_* booleans only). VERIFY no client-path base read remains before applying.
DROP POLICY IF EXISTS "Agency users can view their clients" ON public.clients;
CREATE POLICY "Agency users can view their clients" ON public.clients
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id));

DROP POLICY IF EXISTS "Agency users can update clients" ON public.clients;
CREATE POLICY "Agency users can update clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id));

DROP POLICY IF EXISTS "Agency users can delete clients" ON public.clients;
CREATE POLICY "Agency users can delete clients" ON public.clients
  FOR DELETE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id));

DROP POLICY IF EXISTS "Agency users can insert clients" ON public.clients;
CREATE POLICY "Agency users can insert clients" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id));
```

**Belt-and-braces (optional, verify first):** `REVOKE SELECT, UPDATE, INSERT (supabase_service_key,
supabase_access_token, twilio_auth_token, retell_api_key, openrouter_api_key, openrouter_management_key,
openai_api_key, elevenlabs_api_key, ghl_api_key, intake_lead_secret, ghl_webhook_secret,
unipile_webhook_secret, retell_webhook_secret) ON public.clients FROM authenticated, anon;` — only if the
`rg` sweep proves no browser path reads a secret column directly. Edge functions use `service_role`
(unaffected by this REVOKE).

## 2. `credentials` (RLS-CREDENTIALS-1, High) — clean

**OPEN QUESTION:** confirmed no `frontend/src` read (only `sync-external-credentials` + `refresh-usage-cache`, service-role). Re-confirm.

```sql
DROP POLICY IF EXISTS "agency_all_credentials" ON public.credentials;
CREATE POLICY "agency_all_credentials" ON public.credentials
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND gohighlevel_location_id IN (
    SELECT ghl_location_id FROM clients WHERE agency_id = (SELECT agency_id FROM profiles WHERE id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND gohighlevel_location_id IN (
    SELECT ghl_location_id FROM clients WHERE agency_id = (SELECT agency_id FROM profiles WHERE id = auth.uid())));
```

## 3. `openrouter_usage_cache` (RLS-ORUSAGE-1) — browser-read, MUST role-branch not just gate

**OPEN QUESTION:** the ticker (`useTickerStats.ts`, `useOpenRouterUsage.ts`) reads this under the signed-in
JWT. Confirm the ticker only renders for AGENCY users. If so, an agency-only gate is correct (cost/margin
is agency data). If a client dashboard ever shows it, the client read must be dropped or served via an
agency-only edge fn instead.

```sql
DROP POLICY IF EXISTS "Users can manage openrouter usage cache" ON public.openrouter_usage_cache;
CREATE POLICY "agency_all_openrouter_usage_cache" ON public.openrouter_usage_cache
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
```

## 4. Tenant-disjunction tables (RLS-TENANT-DISJUNCTION-1) — split agency vs client-own

`client_custom_fields`, `lead_ai_columns`, `lead_tags`, `prompt_chat_threads`, `prompt_docs`,
`prompt_versions`, `setter_ai_reports` (+ children `prompt_chat_messages`, `lead_ai_values`,
`lead_tag_assignments` inherit via parent subqueries). Current qual uses `c.agency_id = p.agency_id OR
c.id = p.client_id`, which gives a client-role user agency-wide read+write. Replace with the RLS-UISTATE-1
two-policy shape (agency FOR ALL role-gated + client FOR ALL own-client). **OPEN QUESTION:** these ARE
client-writable (the client UI edits tags/custom fields/prompt docs), so the client policy must keep
read+write on its OWN client. Template per table (client-writable ones keep FOR ALL for the client):

```sql
-- per table T with an existing "<name>" FOR ALL policy:
DROP POLICY IF EXISTS "<existing name>" ON public.T;
CREATE POLICY "agency_all_T" ON public.T FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_T" ON public.T FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));
```
The child tables (`prompt_chat_messages` etc.) join to a parent's client scope; apply the same role branch
in their parent subquery. **Verify each table's exact current policy name + whether it is client-writable
before templating.**

## 5. `unipile_accounts` (RLS-UNIPILE-1) + `agencies` (RLS-AGENCIES-1) — Low, fold in

Add `get_user_role='agency'` to `unipile_accounts` (agency-only; not client-writable) and to the
`agencies` update policy. Verify neither is client-UI-written first.

## 6. Edge functions (RLS-GATE-SIBLING-1) — code, not SQL

Replace the RLS-gate (`userClient.from("clients").eq("id",client_id).single()`) with
`resolveClientAccess` / `authorizeClientRequest` in: `fetch-thread-previews`, `twilio-list-numbers`,
`supabase-project-usage`. Deploy each (non-frozen) with the standard read-only verify.

---

## Verification after applying (dedicated session)
1. `SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN (...) ORDER BY 1,2` — confirm the new shapes.
2. **Live probe (throwaway client-role user):** admin `create-client-user` bound to client A → password-grant to a client JWT → confirm the client CANNOT read `clients`/`credentials`/`openrouter_usage_cache`/sibling tenant rows, but CAN still read `clients_public` + its own tenant rows + write its own tags/custom-fields. Then confirm the AGENCY user's whole UI (dashboard, credentials, ticker, tags) is unaffected. Delete the throwaway.
3. If anything breaks for the agency user, a policy lost its agency match — fix + re-probe before onboarding.
