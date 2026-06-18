# Internal by-phone lead resolution (Spec 1, go-forward) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every go-forward lead resolution deterministic and by-phone, stop minting duplicates, make STOP/opt-out by-phone and enforced on send, preserve voice booking origin, and stop GHL overwriting BFD lead edits — without the historical merge.

**Architecture:** Add one shared `normalizePhone()` (E.164, AU default) + a `leads.normalized_phone` column (additive, NO unique constraint). A shared `resolveLeadByPhone()` returns a single deterministic survivor so booking / inbound voice / inbound SMS / STOP all converge on the same lead row. `lead_optouts` (already `(client_id, phone)`) becomes the authoritative by-phone gate read on every send path. `sync-ghl-contact` becomes BFD-wins (never overwrites identity fields), `bookings-webhook` stops downgrading `voice_call` origin.

**Tech Stack:** Supabase edge functions (Deno, `deno test`), Trigger.dev workers (Node/TS), React frontend (vitest), Postgres (Supabase Management API migrations). Spec: `docs/superpowers/specs/2026-06-18-internal-by-phone-lead-resolution-design.md`.

## Global Constraints

- Additive only: NO `UNIQUE(client_id, normalized_phone)` constraint, NO merge of existing duplicate rows, NO repointing of child tables (those are Spec 2). 
- Do NOT touch the uncommitted cadence-v2 WIP files' WIP content. This plan also edits `trigger/runEngagement.ts` and `trigger/nudgeColdReply.ts`, which carry that WIP in the main checkout — implement in a clean worktree off `main` (see Task 0) so edits land on clean copies; reconciliation with the WIP happens at their merge, not here.
- Do NOT edit any voice-prompt content (not applicable to these files, but the rule stands).
- No em dashes in any copy/strings/comments. Use commas/colons.
- Edge functions deploy with `supabase functions deploy <slug> --use-api --no-verify-jwt` (Brendan deploys; Claude does not deploy without asking). Trigger CLI pinned `@4.4.4`.
- `normalizePhone` returns `null` for unparseable input; callers fall back to existing `lead_id`/email identity and never crash on null.
- `functions/_shared/*.ts` (Deno) and `trigger/_shared/*.ts` (Node) copies of a shared module must be kept byte-identical in logic; the pure logic is tested once via `deno test`.

---

## File structure

**New files:**
- `frontend/supabase/functions/_shared/phone.ts` — `normalizePhone(raw, region?)` (Deno).
- `trigger/_shared/phone.ts` — identical `normalizePhone` (Node).
- `frontend/supabase/functions/_shared/phone.test.ts` — Deno unit tests for the normalizer.
- `frontend/supabase/functions/_shared/leadResolve.ts` — `resolveLeadByPhone(supabase, clientId, normalizedPhone)` (Deno).
- `frontend/supabase/functions/_shared/leadResolve.test.ts` — Deno tests for the resolver.
- `frontend/supabase/functions/_shared/optout.ts` + `trigger/_shared/optout.ts` — `isPhoneOptedOut(supabase, clientId, normalizedPhone)`.
- `frontend/supabase/migrations/20260618_leads_normalized_phone.sql` — add column + backfill + non-unique index.

**Modified (resolution rewires):** `voice-booking-tools/index.ts`, `receive-twilio-sms/index.ts`, `retell-inbound-webhook/index.ts`, `intake-lead/index.ts`.
**Modified (STOP/opt-out):** `stop-bot-webhook/index.ts`, `frontend/src/pages/ContactDetail.tsx`, `trigger/runEngagement.ts`, `trigger/processMessages.ts`, `trigger/sendFollowup.ts`, `trigger/nudgeColdReply.ts`, `trigger/_shared/sendTwilioSmsAndStamp.ts`.
**Modified (BUG B):** `sync-ghl-contact/index.ts`, `push-contact-to-ghl/index.ts`.
**Modified (booking origin):** `bookings-webhook/index.ts`.

Each integration task begins with READING the current function at the cited file:line before editing, because line numbers may have drifted.

---

## Task 0: Isolated worktree + spec/plan on a clean branch

**Files:** none (git infra).

- [ ] **Step 1:** Create a clean worktree off `main` via the `superpowers:using-git-worktrees` skill, branch `feat/internal-by-phone-leads`. This gives clean copies of `runEngagement.ts`/`nudgeColdReply.ts` (no cadence-v2 WIP).
- [ ] **Step 2:** Copy the spec + this plan into the worktree (`docs/superpowers/specs/...` and `docs/superpowers/plans/...`), then commit.

```bash
git add docs/superpowers/specs/2026-06-18-internal-by-phone-lead-resolution-design.md docs/superpowers/plans/2026-06-18-internal-by-phone-lead-resolution.md
git commit -m "docs: spec + plan for internal by-phone lead resolution (Spec 1)"
```

---

## Task 1: `normalizePhone` shared helper + tests

**Files:**
- Create: `frontend/supabase/functions/_shared/phone.ts`
- Create: `trigger/_shared/phone.ts` (byte-identical logic)
- Test: `frontend/supabase/functions/_shared/phone.test.ts`

**Interfaces:**
- Produces: `normalizePhone(raw: string | null | undefined, region?: string): string | null` — returns E.164 (e.g. `+61405482446`) or `null`. `region` defaults to `"AU"`.

- [ ] **Step 1: Write the failing test** (`phone.test.ts`)

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizePhone } from "./phone.ts";

Deno.test("AU national mobile -> E.164", () => {
  assertEquals(normalizePhone("0405 482 446"), "+61405482446");
  assertEquals(normalizePhone("0405482446"), "+61405482446");
});
Deno.test("already E.164 is preserved", () => {
  assertEquals(normalizePhone("+61405482446"), "+61405482446");
  assertEquals(normalizePhone("+61 405 482 446"), "+61405482446");
});
Deno.test("formatting chars stripped", () => {
  assertEquals(normalizePhone("(04) 0548-2446"), "+61405482446");
});
Deno.test("international + preserved (non-AU)", () => {
  assertEquals(normalizePhone("+14155552671"), "+14155552671");
});
Deno.test("unparseable -> null", () => {
  assertEquals(normalizePhone(""), null);
  assertEquals(normalizePhone(null), null);
  assertEquals(normalizePhone("abc"), null);
  assertEquals(normalizePhone("12"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/supabase/functions/_shared && deno test phone.test.ts`
Expected: FAIL ("Module not found ./phone.ts" or "normalizePhone is not exported").

- [ ] **Step 3: Write minimal implementation** (`frontend/supabase/functions/_shared/phone.ts`)

```ts
// Single source of truth for phone normalization. Keep trigger/_shared/phone.ts byte-identical.
// E.164 output, AU default region. Dependency-free (AU-centric); extend region handling when a non-AU client lands.
export function normalizePhone(raw: string | null | undefined, region: string = "AU"): string | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (hadPlus) {
    // Already international; trust the digits after the +.
    return digits.length >= 8 ? `+${digits}` : null;
  }
  if (region === "AU") {
    // AU national: 0XXXXXXXXX (10 digits) -> +61XXXXXXXXX
    if (digits.length === 10 && digits.startsWith("0")) return `+61${digits.slice(1)}`;
    // Bare AU subscriber number without trunk 0 (9 digits, mobile starts 4)
    if (digits.length === 9 && digits.startsWith("4")) return `+61${digits}`;
    // Already has 61 country code without +
    if (digits.startsWith("61") && digits.length === 11) return `+${digits}`;
  }
  // Fallback: a plausible-length raw international number without +.
  if (digits.length >= 11) return `+${digits}`;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/supabase/functions/_shared && deno test phone.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Mirror to trigger** — create `trigger/_shared/phone.ts` with the identical function body (same code as Step 3, minus the Deno-only comment if desired). Keep logic identical.

- [ ] **Step 6: Commit**

```bash
git add frontend/supabase/functions/_shared/phone.ts frontend/supabase/functions/_shared/phone.test.ts trigger/_shared/phone.ts
git commit -m "feat(leads): shared normalizePhone E.164 helper + tests"
```

---

## Task 2: `leads.normalized_phone` migration (additive)

**Files:**
- Create: `frontend/supabase/migrations/20260618_leads_normalized_phone.sql`

**Interfaces:**
- Produces: `leads.normalized_phone text` (nullable) + non-unique index `idx_leads_normalized_phone (client_id, normalized_phone)`.

- [ ] **Step 1: Write the migration**

```sql
-- Spec 1 (go-forward): additive only. NO unique constraint (the existing duplicate rows coexist; merge is Spec 2).
alter table public.leads add column if not exists normalized_phone text;

-- Backfill from existing phone using the same AU-default rules as normalizePhone (kept in sync deliberately).
update public.leads
set normalized_phone = case
  when phone is null or btrim(phone) = '' then null
  when phone ~ '^\+' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$' then '+61' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2)
  when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^61[0-9]{9}$' then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  else null
end
where normalized_phone is null;

create index if not exists idx_leads_normalized_phone on public.leads (client_id, normalized_phone) where normalized_phone is not null;
```

- [ ] **Step 2: Apply via the Supabase Management API (Brendan or Claude with PAT)** and verify read-only:

Run (read-only check after apply): the backfill produced one shared `normalized_phone` for the dogfood dupes:
`select normalized_phone, count(*) from leads where client_id='e467dabc-57ee-416c-8831-83ecd9c7c925' group by 1 order by 2 desc;`
Expected: `+61405482446 | 10`, `+61467853118 | 2`, `null | 9` (matches the pre-pivot cardinality).

- [ ] **Step 3: Commit**

```bash
git add frontend/supabase/migrations/20260618_leads_normalized_phone.sql
git commit -m "feat(leads): add leads.normalized_phone column + backfill (additive)"
```

---

## Task 3: `resolveLeadByPhone` deterministic resolver + tests

**Files:**
- Create: `frontend/supabase/functions/_shared/leadResolve.ts`
- Test: `frontend/supabase/functions/_shared/leadResolve.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` (Task 1).
- Produces: `resolveLeadByPhone(supabase, clientId: string, normalizedPhone: string): Promise<LeadRow | null>` — returns the single deterministic survivor (`order by updated_at desc nulls last, created_at desc limit 1`) or `null` if none.

- [ ] **Step 1: Write the failing test** using a fake supabase query builder that records the order/limit and returns canned rows.

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveLeadByPhone } from "./leadResolve.ts";

function fakeSupabase(rows: any[]) {
  const calls: any = {};
  const builder: any = {
    select: () => builder, eq: (k: string, v: string) => { calls[k] = v; return builder; },
    order: (col: string, opts: any) => { calls.order = calls.order ?? []; calls.order.push([col, opts]); return builder; },
    limit: (n: number) => { calls.limit = n; return builder; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  };
  return { from: () => builder, _calls: calls };
}

Deno.test("returns the most-recent survivor and orders deterministically", async () => {
  const sb = fakeSupabase([{ id: "winner", updated_at: "2026-06-17T00:00:00Z" }]);
  const lead = await resolveLeadByPhone(sb as any, "client1", "+61405482446");
  assertEquals(lead?.id, "winner");
  assertEquals(sb._calls.client_id, "client1");
  assertEquals(sb._calls.normalized_phone, "+61405482446");
  assertEquals(sb._calls.limit, 1);
  assertEquals(sb._calls.order[0][0], "updated_at");
});

Deno.test("returns null when none match", async () => {
  const sb = fakeSupabase([]);
  assertEquals(await resolveLeadByPhone(sb as any, "c", "+61400000000"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/supabase/functions/_shared && deno test leadResolve.test.ts`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Write minimal implementation** (`leadResolve.ts`)

```ts
export interface LeadRow { id: string; lead_id?: string | null; phone?: string | null; [k: string]: unknown }

export async function resolveLeadByPhone(
  supabase: any, clientId: string, normalizedPhone: string,
): Promise<LeadRow | null> {
  if (!normalizedPhone) return null;
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("client_id", clientId)
    .eq("normalized_phone", normalizedPhone)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/supabase/functions/_shared && deno test leadResolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/supabase/functions/_shared/leadResolve.ts frontend/supabase/functions/_shared/leadResolve.test.ts
git commit -m "feat(leads): deterministic resolveLeadByPhone survivor helper + tests"
```

---

## Task 4: `isPhoneOptedOut` by-phone gate helper + tests

**Files:**
- Create: `frontend/supabase/functions/_shared/optout.ts`
- Create: `trigger/_shared/optout.ts` (identical logic)
- Test: `frontend/supabase/functions/_shared/optout.test.ts`

**Interfaces:**
- Produces: `isPhoneOptedOut(supabase, clientId: string, normalizedPhone: string): Promise<boolean>` — true if a `lead_optouts` row exists for `(client_id, normalized phone)`.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPhoneOptedOut } from "./optout.ts";
function fakeSb(row: any) {
  const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: row, error: null }) };
  return { from: () => b };
}
Deno.test("opted out when a row exists", async () => {
  assertEquals(await isPhoneOptedOut(fakeSb({ phone: "+61405482446" }) as any, "c", "+61405482446"), true);
});
Deno.test("not opted out when none and when phone null", async () => {
  assertEquals(await isPhoneOptedOut(fakeSb(null) as any, "c", "+61405482446"), false);
  assertEquals(await isPhoneOptedOut(fakeSb(null) as any, "c", ""), false);
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `deno test optout.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`optout.ts`)

```ts
export async function isPhoneOptedOut(supabase: any, clientId: string, normalizedPhone: string): Promise<boolean> {
  if (!normalizedPhone) return false;
  const { data } = await supabase
    .from("lead_optouts").select("phone").eq("client_id", clientId).eq("phone", normalizedPhone).maybeSingle();
  return !!data;
}
```

- [ ] **Step 4: Run test → PASS.** Then mirror to `trigger/_shared/optout.ts` (identical).

- [ ] **Step 5: Commit**

```bash
git add frontend/supabase/functions/_shared/optout.ts frontend/supabase/functions/_shared/optout.test.ts trigger/_shared/optout.ts
git commit -m "feat(leads): isPhoneOptedOut by-phone gate helper + tests"
```

---

## Task 5: voice-booking-tools — internal-first contact resolution

**Files:** Modify `frontend/supabase/functions/voice-booking-tools/index.ts` (`resolveContactId` ~271-367, `toolLookupContact` ~743-754). Test: add `voice-booking-tools/resolveContact.test.ts` if a unit boundary is extractable, else assert via the resolver test from Task 3 + a manual live booking re-test.

**Interfaces:** Consumes `normalizePhone`, `resolveLeadByPhone`.

- [ ] **Step 1: Read** `resolveContactId` and `toolLookupContact` fully before editing.
- [ ] **Step 2:** In `resolveContactId`, BEFORE the GHL `/contacts?limit=1&query=<phone>` call, normalize the phone and call `resolveLeadByPhone`. If a lead is found, use its `lead_id` (the mirrored GHL contact id) as `contactId` and return it; only fall through to the GHL search/create when no internal lead exists. Keep `createIfMissing` creating exactly one mirror contact + lead. Same change in `toolLookupContact`.
- [ ] **Step 3: Test** — add a deno test that, given a fake supabase returning a survivor lead, `resolveContactId` returns that lead's `lead_id` and never calls the GHL search. Run `deno test`, expect PASS.
- [ ] **Step 4: Type-check** `deno check index.ts` (expect no NEW errors vs HEAD).
- [ ] **Step 5: Commit** `git commit -m "fix(voice-booking-tools): resolve booking contact internally by phone (kills contacts[0] arbitrariness)"`.

---

## Task 6: receive-twilio-sms — internal-first + stop minting duplicates

**Files:** Modify `frontend/supabase/functions/receive-twilio-sms/index.ts` (`findOrCreateGhlContact` ~320-392, call site ~616; STOP block ~494-543; leads upsert ~804-821).

- [ ] **Step 1: Read** the inbound flow + `findOrCreateGhlContact` + STOP block.
- [ ] **Step 2:** Normalize `fromPhone` once at the top. Replace the identity role of `findOrCreateGhlContact`: call `resolveLeadByPhone` first; reuse its `lead_id`; only `findOrCreateGhlContact` (mirror) when no internal lead exists. Do not POST a new `SMS Lead` GHL contact when a lead already exists for the phone.
- [ ] **Step 3:** Unify the STOP block to normalized phone (write `lead_optouts.phone = normalizedPhone`, set `setter_stopped` on all rows matching `client_id` + `normalized_phone`).
- [ ] **Step 4: Test** — deno test: an inbound SMS for an existing-survivor phone resolves to that lead and does NOT create a GHL contact. Run, PASS.
- [ ] **Step 5: deno check; Commit** `fix(receive-twilio-sms): internal by-phone lead resolution; stop minting duplicate SMS contacts`.

---

## Task 7: retell-inbound-webhook — deterministic resolver

**Files:** Modify `frontend/supabase/functions/retell-inbound-webhook/index.ts` (~98-125).

- [ ] **Step 1: Read** the lead-lookup block (exact + last-9 suffix `ilike`).
- [ ] **Step 2:** Replace it with `normalizePhone(fromNumber)` + `resolveLeadByPhone`. On a hit, populate dynamic vars from the survivor (removes the ">1 match returns empty" dead-end so repeat callers resolve). On miss, keep the current unknown-caller fallback.
- [ ] **Step 3: Test** — deno test: a `from_number` matching multiple rows now returns the survivor's dynamic vars (not empty). Run, PASS.
- [ ] **Step 4: deno check; Commit** `fix(retell-inbound-webhook): resolve inbound caller deterministically by normalized phone`.

---

## Task 8: intake-lead — resolve/reuse by phone before create

**Files:** Modify `frontend/supabase/functions/intake-lead/index.ts` (~297, 310, 337-350; `normalisePhone` ~61-68).

- [ ] **Step 1: Read** the create/upsert path + local `normalisePhone`.
- [ ] **Step 2:** Replace the local `normalisePhone` with the shared `normalizePhone`. Before `findOrCreateGhlContact`, call `resolveLeadByPhone`; if a lead exists, reuse it (no new GHL contact, no new lead row); else keep current create. Set `normalized_phone` on any new lead row.
- [ ] **Step 3: Test** — deno test: intake for an existing-phone lead reuses it. Run, PASS.
- [ ] **Step 4: deno check; Commit** `fix(intake-lead): reuse existing lead by normalized phone; set normalized_phone on create`.

---

## Task 9: Send-path opt-out gate (Trigger workers)

**Files:** Modify `trigger/runEngagement.ts` (`isCancelled` ~292-334), `trigger/processMessages.ts` (STEP 1.5 ~183-206), `trigger/sendFollowup.ts` (~104-117), `trigger/nudgeColdReply.ts` (~77, 269-281), `trigger/_shared/sendTwilioSmsAndStamp.ts`.

- [ ] **Step 1: Read** each send checkpoint.
- [ ] **Step 2:** In each, before sending, compute `normalizePhone(lead.phone)` and call `isPhoneOptedOut`; if true, treat as cancelled/skip (mirror the existing `setter_stopped` short-circuit). `sendTwilioSmsAndStamp` gets a final defensive gate so no path can send to an opted-out phone.
- [ ] **Step 3: Test** — a unit/integration test (deno or the trigger test runner used by the existing `_shared/lifecycle.test.ts`) asserting a standing `lead_optouts` row blocks the send in `sendTwilioSmsAndStamp`. Run, PASS.
- [ ] **Step 4: Type-check** (`cd frontend && npx tsc --noEmit` covers shared types if applicable; trigger `deno check`/tsc as used). **Commit** `feat(send-paths): enforce by-phone lead_optouts gate before every send`.

> Reconciliation note: `runEngagement.ts` + `nudgeColdReply.ts` also carry uncommitted cadence-v2 WIP in the main checkout. These edits are on clean copies in the worktree; resolve the overlap when the two branches merge.

---

## Task 10: UI STOP by-phone + fix broken ContactDetail STOP

**Files:** Modify `frontend/supabase/functions/stop-bot-webhook/index.ts` (~71-77), `frontend/src/pages/ContactDetail.tsx` (STOP wiring ~1339), `frontend/src/utils/contactId.ts` if needed.

- [ ] **Step 1: Read** `stop-bot-webhook` + both UI callers (Chats passes `leads.id` uuid; ContactDetail passes text `lead_id`).
- [ ] **Step 2:** Make `stop-bot-webhook` resolve the target lead's `normalized_phone` (accept either a uuid `id` or a text `lead_id`), then set `setter_stopped` on ALL rows sharing `(client_id, normalized_phone)` AND upsert `lead_optouts(client_id, phone=normalized_phone)`. Mirror START symmetrically.
- [ ] **Step 3:** Fix ContactDetail so STOP succeeds (pass an id the webhook resolves). Surface scope to the operator ("stops all leads on this number").
- [ ] **Step 4: Test** — vitest for the ContactDetail handler call shape; deno test for the webhook resolving by either id form. Run, PASS.
- [ ] **Step 5: tsc --noEmit; Commit** `fix(stop): UI STOP is by-phone (all leads sharing the number) + repair ContactDetail STOP`.

---

## Task 11: Enrolment-time opt-out check (re-arm fix)

**Files:** Modify the enrolment ingress (`intake-lead/index.ts` and/or `trigger-engagement/index.ts`) where a new lead is armed.

- [ ] **Step 1: Read** the arm path.
- [ ] **Step 2:** Before arming a new cadence for a phone, call `isPhoneOptedOut`; if opted out, do not arm (and stamp `setter_stopped=true` on the new row).
- [ ] **Step 3: Test** — opted-out phone re-ingested is born stopped / not armed. Run, PASS.
- [ ] **Step 4: Commit** `fix(enrolment): do not re-arm a phone with a standing opt-out`.

---

## Task 12: BUG B — sync-ghl-contact BFD-wins + push clear-handling

**Files:** Modify `frontend/supabase/functions/sync-ghl-contact/index.ts` (~432-444), `frontend/supabase/functions/push-contact-to-ghl/index.ts` (~124-150).

- [ ] **Step 1: Read** the `sync-ghl-contact` existing-lead UPDATE branch + `push-contact-to-ghl` body builder.
- [ ] **Step 2:** In `sync-ghl-contact`, for an EXISTING lead, do NOT overwrite `first_name/last_name/email/phone` from the GHL payload (treat `contact.update` as routing-only for identity fields; still allowed to set them on a brand-new lead insert). Remove reliance on the leaky 60s echo-guard for these fields.
- [ ] **Step 3:** In `push-contact-to-ghl`, ensure a deliberately cleared field is pushed as an explicit clear (BFD value wins upstream).
- [ ] **Step 4: Test** — deno test: given an existing lead, a `sync-ghl-contact` `contact.update` with different name/phone does NOT change the leads row identity fields; a cleared field stays cleared. Run, PASS.
- [ ] **Step 5: deno check; Commit** `fix(sync): BFD-wins on lead identity fields; stop GHL re-sync overwriting edits (BUG B)`.

---

## Task 13: bookings-webhook — preserve voice_call origin

**Files:** Modify `frontend/supabase/functions/bookings-webhook/index.ts` (~204-223, source set ~217-218).

- [ ] **Step 1: Read** the upsert + the `source='ghl_calendar'` set on confirmed/attended.
- [ ] **Step 2:** Set `source` only on insert / when the existing row has no origin; never downgrade an existing non-`ghl_calendar` source (e.g. `voice_call`). Read the existing row first (or use a conditional upsert) so a confirmed-event re-upsert does not clobber `voice_call`.
- [ ] **Step 3: Test** — deno test: an appointment confirm event for a row already `source='voice_call'` leaves source `voice_call`; a fresh GHL walk-in row gets `ghl_calendar`. Run, PASS.
- [ ] **Step 4: deno check; Commit** `fix(bookings-webhook): never downgrade voice_call origin to ghl_calendar`.

---

## Task 14: Final verification + handoff

- [ ] **Step 1:** `cd frontend && npx tsc --noEmit` (0 new errors). `deno check` on each touched edge fn (no NEW errors vs HEAD). Run the full `deno test` suite for `_shared`.
- [ ] **Step 2:** Read-only DB re-check: `normalized_phone` backfilled; `lead_optouts` gate behavior reasoned through; no unique constraint added.
- [ ] **Step 3:** Surface a Brendan-side deploy + smoke checklist (deploy the touched edge fns + Trigger; live re-test: an inbound SMS/voice to +61405482446 resolves to ONE survivor; a STOP stops the phone; a fresh inbound after STOP does not send; a voice booking attaches to the survivor; an edit in ContactDetail survives a GHL re-sync).
- [ ] **Step 4:** Open the PR for `feat/internal-by-phone-leads`; note the `runEngagement.ts`/`nudgeColdReply.ts` reconciliation vs the cadence-v2 WIP.

---

## Self-review (against the spec)

- Spec part 1 (normalizer) → Task 1. Part 2 (column) → Task 2. Part 3 (resolver + ingress rewire) → Tasks 3, 5, 6, 7, 8. Part 4 (STOP/opt-out) → Tasks 4, 9, 10, 11. Part 5 (BUG B) → Task 12. Part 6 (booking origin) → Task 13. Testing → per-task + Task 14. Non-goals (unique constraint, merge, child repoint) correctly excluded.
- No placeholders in new-file code (phone.ts, leadResolve.ts, optout.ts, migration, tests are complete). Integration tasks are read-then-edit with the concrete change + test described, because the target line numbers may have drifted and the edit must match live source.
- Type consistency: `normalizePhone`, `resolveLeadByPhone`, `isPhoneOptedOut` signatures are defined once (Tasks 1, 3, 4) and consumed by name in Tasks 5-13.
