---
description: Research-only brief for roadmap 3.1 (A/B testing) covering viability, the three test levels (campaign / agent / AI-variant), schema changes, measurement against cadence_metrics, statistical validity at 50-200 leads/week with booking rate primary, the report-only prompt constraint, the AI-evaluation loop, blast radius, and a phased build recommendation. No feature code.
---

# A/B Testing Research Brief (Roadmap 3.1)

**Status:** RESEARCH ONLY. No code, no migrations, no prompt edits. This report is the input to a
go / no-go and a phased build decision. Nothing here is built.

**Date:** 2026-06-16
**Author:** Claude (research session)
**Scope inputs confirmed with Brendan:** realistic per-client volume = **moderate, 50-200 new
leads/week**; primary "winner" metric = **booking rate** (other metrics tracked as secondary).

**Reference-name correction:** the kickoff brief points at `FEATURE_ROADMAP.md §3.1a/b/c`. That
file does not exist. The canonical A/B design lives in [Docs/ROADMAP.md](ROADMAP.md) under
"Future feature: A/B testing" (lines 163-177). The a/b/c layer labels (campaign-level,
agent-level, AI-variants) come from the kickoff doc framing in
[Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md](archive/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md#L54).
This report supersedes the one-paragraph ROADMAP design where the research found a sharper path.

---

## 1. Executive summary and verdict

**Short-term answer: do NOT build it yet. Ship this research and defer the build** until there is
at least one paying client running real lead volume. The full reasoning is in section 1.5; the rest
of this report is the design that becomes relevant once that trigger is met.

**As a design (when the trigger is met): worth building, phased and scoped to the volume.** A/B
testing is broadly useful across clients and most of the runtime plumbing already exists (the tag
resolver, per-campaign and per-node setter selection, the Try-Gary clone, Retell weighted agent
lists, and `cadence_metrics`). The honest constraint is not engineering, it is **statistics**: at
50-200 leads/week split two ways, **booking rate can only prove large effects** (close to a
doubling) inside a sane time box. That single fact shapes every recommendation below.

**Recommended build order:**

1. **Phase 1 = 3.1a campaign-level A/B (BUILD FIRST).** Two existing workflows share one inbound
   tag; the resolver splits leads between them; results are already separable because each arm is a
   distinct `workflow_id` that `cadence_metrics` already keys on. Lowest risk, cheapest measurement,
   directly matches the ROADMAP design. **Effort: M (~3-4 days).**
2. **Phase 2 = the within-workflow "arm stamp" + 3.1b agent-level A/B (BUILD SECOND).** Add a
   `variant` label to `engagement_executions` and `cadence_metrics` so two setters inside one
   campaign can be compared. Reuses the Try-Gary clone (separate slots) and Retell weighted lists.
   **Effort: M-L (~4-6 days).**
3. **Phase 3 = 3.1c AI-generated variants + the AI-evaluation loop (DEFER until volume + Phase 2
   exist).** Generate and persist multiple AI copy variants, attribute outcomes, and add a
   scheduled AI reviewer that proposes (never applies) the next test. **Effort: L (~5-8 days),
   gated on having the arm stamp and enough volume to learn from.**

**Headline caveat to put in front of any client expectation:** with booking rate as the decision
metric at this volume, only **bold** hypotheses are worth A/B-ing (text-only vs text-plus-call,
very different timing, a genuinely different persona). Micro-copy tweaks will never reach
significance here, so test big swings and read **reply rate** as the fast leading indicator while
booking rate accumulates.

---

## 1.5 Business viability and timing (the short-term answer)

This section answers "is it worth building short-to-medium term?" separately from "is the design
sound?" (it is). The business answer is a clear **no for now**, and the reasons are about company
stage, not engineering.

**Where BFD actually is (verified against the business docs, 2026-06-16):**
- **0 paying clients, $0 MRR, 0 active pilots.** The only live platform user is Brendan; the only
  live phone is the dogfood line. (`Operations/daily-notes/2026-06-05-overnight-worklog.md`,
  `Company/kpis/kpi-tracker.md`, `Operations/handoffs/2026-06-13-tier0-4-build.md`.)
- **No real lead traffic.** Current activity is dogfood/test calls to Brendan's own phone plus the
  synthetic probe (currently red). Weekly real lead volume through the platform is effectively zero.
- **Active constraint: a build-freeze sales sprint (Jun 4 - Jul 1), whose only goal is one $499
  paid pilot via direct outreach.** The prior 90-day MRR target was missed on June 1, and the
  retrospective names the failure mode explicitly: *"the product became a hiding place... built more
  than sold."* (`Company/goals/90-day-plan-v2.md`.)

**Why that makes A/B premature right now:**
1. **There is nothing to test.** A/B testing optimizes existing traffic. With zero clients and zero
   real leads, there is no traffic to split and no one to benefit. By the statistics in section 7,
   a booking-rate test needs ~50-200 leads/week per client just to resolve a near-doubling; BFD has
   none of that yet.
2. **The opportunity cost is bad.** A/B is **Build 2**, gated behind a Build 1 cluster where every
   item is revenue/onboarding-critical, not optimization: the LOCKED-GO GHL->Twilio SMS send-path
   migration, arming the Retell/Unipile webhook secrets, the secret-column lockdown, plus Brendan
   re-saving the 4 Garys and AU SMS A2P, then the full live run-through test. Spending 1-2 weeks on
   A/B displaces the work that actually unblocks landing and keeping a paying client.
3. **It is premature on dependencies.** The comparison surface depends on `cadence_metrics` history
   (the cost-per-booking dashboard, item 2.6, is itself gated on ~60 days of data), and the platform
   already has a more justified split-test in the path: the **CF pilot A/B** that gates the
   conversation-flow fleet rollout. That needs none of this feature.
4. **It risks the documented anti-pattern.** Building a sophisticated optimization engine with no
   users to optimize is exactly the "build as a hiding place from selling" pattern the business
   retrospective warns against.

**Revisit trigger (when this stops being premature):** the **first paying client sustaining roughly
50+ leads/week**, OR a specific deal where "we continuously A/B-optimize your setter" is what closes
it. Until one of those is true, this report stays shelved.

**Cheap interim that needs no build:** for the first client, run cadence/setter A for ~2 weeks, then
B for ~2 weeks, and eyeball booking + reply rate. That covers client #1 manually and tells you
whether the automated engine is even worth building. You can also *sell the promise*
("we continuously test and optimize your setter") for a $499 pilot delivered manually, without the
feature existing. The automated version is an efficiency play for when several clients are live.

**When the trigger is met, build only the cheapest slice first:** Phase 1 / 3.1a campaign-level
(section 11), and add 3.1b/3.1c only if the manual approach proves automation is worth it.

---

## 2. Roadmap reconciliation: the three levels

| Level | What it tests | Where the variant lives | Headline blocker |
|---|---|---|---|
| **3.1a campaign-level** | Whole-cadence differences (timing, channel mix, framework) | Two `engagement_workflows` sharing a tag | The tag's partial unique index + the deterministic resolver |
| **3.1b agent-level** | Setter / persona / voice differences inside one cadence | Two setters (text slot or voice setter) inside one workflow | No per-arm attribution column exists (both arms share `workflow_id`) |
| **3.1c AI-variant** | Auto-generated copy variations | Two outputs of `aiGenerateEngagementCopy` | Generated copy is ephemeral and never stamped with a variant id |

The two kickoff briefs add a **second phase on top of all three levels**: an **AI-evaluation loop**
that periodically reads the results, judges a winner, and proposes the next test
([NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md](archive/NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md#L53-L57)).
That loop is treated as its own phase (section 9), not a fourth level.

---

## 3. What plumbing already exists (reuse map)

This is the most important section for scoping: most of an A/B engine is already in the tree.

- **Tag resolver (deterministic today).**
  [resolve-workflow.ts](frontend/supabase/functions/_shared/resolve-workflow.ts#L37-L47):
  `matchWorkflowByTag` returns the **first** new-leads workflow whose tag matches the inbound tags.
  Pure decision functions split out from the DB fetch and already unit-tested
  ([resolve-workflow.test.ts](frontend/supabase/functions/_shared/resolve-workflow.test.ts)). This
  is the exact seam an A/B variant picker plugs into.
- **One-workflow-per-tag index.**
  [20260530120000_form_routing_multi_new_leads.sql](frontend/supabase/migrations/20260530120000_form_routing_multi_new_leads.sql#L22-L24):
  `UNIQUE (client_id, new_leads_tag) WHERE is_new_leads_campaign = true AND new_leads_tag IS NOT NULL`.
- **Per-campaign text setter.** `engagement_campaigns.text_setter_number` (single int, default 1),
  resolved in [runEngagement.ts](trigger/runEngagement.ts#L909-L917) and stamped onto outgoing
  SMS/WhatsApp payloads.
- **Per-node voice setter + override.** Each `phone_call` channel carries `voice_setter_id`
  (slot id), with the proven `voice_setter_id_override` path (Try-Gary) resolved in
  [runEngagement.ts](trigger/runEngagement.ts#L1135-L1180).
- **Setter cloning (variant creation, no AI).**
  [duplicate-setter-config/index.ts](frontend/supabase/functions/duplicate-setter-config/index.ts):
  auto-allocates the lowest free slot (voice 4-10, text 2-10), copies prompt + config + agent
  settings, marks the clone inactive with empty directions, rolls back atomically on failure. This
  is how a "variant B" setter already gets created today without touching variant A.
- **Retell weighted agent lists.**
  [retell-proxy/index.ts](frontend/supabase/functions/retell-proxy/index.ts#L265-L385):
  `inbound_agents` / `outbound_agents` already accept `[{agent_id, agent_version, weight}]`. BFD
  populates a single agent at weight 1 today, but the weighting mechanism for voice rotation is
  already there.
- **Outcome metrics.**
  [20260430120000_phase7a_tracking_schema.sql](frontend/supabase/migrations/20260430120000_phase7a_tracking_schema.sql):
  `cadence_metrics` keyed by `execution_id`, `client_id`, `workflow_id`, `lead_id`, recording
  `sms_sent/delivered`, `calls_attempted/picked_up`, `reply_received`,
  `time_to_first_response_seconds`, `booking_created`, `time_to_booking_seconds`, plus
  `ai_cost_cents` / `cost_estimate_cents` (added in
  [20260513150000_cadence_v2_day3_email_metrics.sql](frontend/supabase/migrations/20260513150000_cadence_v2_day3_email_metrics.sql)).
- **AI copy generation.**
  [aiGenerateEngagementCopy.ts](trigger/_shared/aiGenerateEngagementCopy.ts): produces one
  `{subject?, body}` per call from a per-client model, returns cost + token counts, falls back to
  static copy on failure. Never persists the generated text or any variant id.

**Takeaway:** the resolver, the clone, the weighted lists, and the metrics table mean A/B is
mostly an **assignment + attribution + reporting** problem, not a new-engine problem.

---

## 4. (a) The three A/B levels compared

### 3.1a campaign-level (RECOMMENDED FIRST)
- **What it tests:** entire cadences against each other under one inbound tag. The highest-leverage
  thing to test at this volume (big structural differences: text-only vs text+call, 3-touch vs
  7-touch, day-0 call vs day-2 call).
- **Reuses:** the tag model, the resolver, and crucially `cadence_metrics` already splits by
  `workflow_id`, so each arm's funnel is already separable with zero new attribution columns.
- **Blocks on:** the one-workflow-per-tag index (section 3) and the deterministic first-match
  resolver (needs a rotation step).
- **Relative cost:** lowest. This is the "do this first" layer.

### 3.1b agent-level
- **What it tests:** the setter / persona / voice inside one otherwise-identical cadence (e.g.
  Crazy Gary vs Property Coach on the same nodes; or two SMS personas).
- **Reuses:** the Try-Gary clone to mint "variant B" as a separate slot (so no unique-constraint
  change is required), the per-node `voice_setter_id` / override mechanism, and Retell weighted
  lists for outbound voice rotation.
- **Blocks on:** attribution. Both arms run under the **same `workflow_id`**, so `cadence_metrics`
  cannot tell them apart today. This is the layer that forces the new "arm stamp" (section 5).
- **Relative cost:** medium. The engineering is the arm stamp plus a per-node or per-campaign
  variant picker.

### 3.1c AI-generated variant
- **What it tests:** machine-generated copy variations (subject lines, SMS phrasings) against each
  other, optionally model-vs-model.
- **Reuses:** `aiGenerateEngagementCopy` (would call it for N variants, or pre-generate at design
  time).
- **Blocks on:** the generated copy is ephemeral and unstamped, so there is no record of which lead
  got which variant. Needs variant generation + persistence + the same arm stamp as 3.1b. Also the
  hungriest for volume (many small copy variants dilute per-arm sample size fastest).
- **Relative cost:** highest, and lowest value at 50-200 leads/week. Defer.

---

## 5. (b) Schema changes per level

Principle: **add the smallest stamp that makes outcomes attributable, reuse `cadence_metrics`,
relax exactly one index, and keep the default (non-A/B) path byte-for-byte unchanged.** Migration
names follow the confirmed convention `YYYYMMDDHHMM00_slug.sql`.

### For 3.1a (campaign-level)
1. **Relax the tag index.** Replace
   `engagement_workflows_new_leads_tag_unique` so two workflows can share a tag **only when they
   belong to the same A/B group**. Two clean options:
   - *Group owns the tag (preferred):* member workflows set `new_leads_tag = NULL` (excluded by the
     index automatically) and instead reference an `ab_test_groups.id`; the group row holds the
     tag. The existing index then needs no change at all, which is the lowest-risk path.
   - *Composite key:* widen the index to `(client_id, new_leads_tag, ab_group_id)`. More invasive.
   Recommend **group-owns-the-tag** because it leaves the existing partial index untouched and keeps
   single-campaign routing exactly as it is today.
2. **New `ab_test_groups` table** (per the ROADMAP design): `id, client_id, new_leads_tag,
   variant_workflow_ids[], split ('round_robin' | 'weighted'), weights, assign_counter,
   status ('running' | 'paused' | 'concluded'), started_at, min_sample_per_arm, decision_metric`.
3. **Resolver rotation** in
   [resolve-workflow.ts](frontend/supabase/functions/_shared/resolve-workflow.ts): before the
   first-match return, check whether the inbound tag maps to a running A/B group; if so, pick a
   variant (see "assignment strategy" below) instead of returning the first workflow.

### For 3.1b / 3.1c (within-workflow)
1. **The arm stamp (the one essential new column).** Add `variant text` (nullable) to
   `engagement_executions` and carry it through to `cadence_metrics` in `writeCadenceMetrics`
   ([runEngagement.ts](trigger/runEngagement.ts), the metrics writer). Null = not in a test = the
   default path. With this one column, every existing metric (`booking_created`, `reply_received`,
   `time_to_booking_seconds`, `ai_cost_cents`) becomes per-arm with no other change.
2. **Variant assignment record (optional but recommended for stickiness):** a light
   `ab_assignments (experiment_id, lead_id, variant, assigned_at)` so a lead that re-enters stays in
   the same arm and so assignment is auditable. Alternatively, derive stickiness from a hash of
   `lead_id` (no table). Recommend the table for voice, where re-fires are common.
3. **3.1c only:** when `aiGenerateEngagementCopy` is used in a test, persist the chosen variant
   (id + text + model) alongside the execution so the copy that produced an outcome is recoverable.

### Assignment strategy (applies to every level)
- **Round-robin** via an atomically incremented `assign_counter mod N`: simplest, balances arms
  exactly, but a re-entering lead can flip arms.
- **Sticky-by-lead hash** (`hash(lead_id) mod N`): a lead always lands in the same arm, which is
  the correct behavior when a lead can re-enter a cadence. Slightly uneven splits at low N.
- **Recommendation:** sticky-by-lead for correctness (matches the ROADMAP note), with round-robin
  acceptable for a v1 if re-entry is rare. This mirrors the verified ROADMAP guidance
  ([ROADMAP.md](ROADMAP.md#L173)).

---

## 6. (c) Measuring results against `cadence_metrics`

**The good news for 3.1a:** each arm is a distinct `workflow_id`, and `cadence_metrics.workflow_id`
already exists and is indexed. A comparison view is a `GROUP BY workflow_id` over a date window with
`booking_created`, `reply_received`, and `time_to_booking_seconds` aggregated per arm. The
`ab_test_groups` row supplies the stable pairing and the window so the dashboard compares the right
two workflows over the right period. Effectively **no new attribution data is needed** for the
campaign level, only the grouping and the view.

**The gap for 3.1b / 3.1c:** both arms share `workflow_id`, so `cadence_metrics` cannot separate
them today. This is precisely what the `variant` arm stamp (section 5) fixes; once present, the same
`GROUP BY` becomes `GROUP BY workflow_id, variant`.

**Voice attribution caveat.** For outbound voice, the Retell agent that handled a call is recorded
as `call_history.agent_id`, which can be matched back to `voice_setters.retell_agent_id`. That match
is fragile (string equality, no foreign key, voice only) and should not be the primary attribution
path. The arm stamp on the execution is the reliable source of truth; the `agent_id` match is a
cross-check.

**Comparison shape (read-only view, no new event pipeline):**
```
per arm, over [started_at .. now or concluded_at]:
  enrolled          = count(distinct execution_id)
  reply_rate        = avg(reply_received)
  booking_rate      = avg(booking_created)            <- primary decision metric
  median_ttb        = median(time_to_booking_seconds)
  cost_per_booking  = sum(ai_cost_cents + cost_estimate_cents) / nullif(sum(booking_created),0)
```
All five already exist as columns; the only additions are the grouping key (`workflow_id` for 3.1a,
`workflow_id, variant` for 3.1b/c).

---

## 7. (d) Statistical validity at 50-200 leads/week (booking rate primary)

This is the section that should govern expectations. Split two ways, 50-200 leads/week is **25-100
leads/arm/week**. Using a standard two-proportion test (80% power, two-sided alpha = 0.05,
`n_per_arm ≈ 7.84 · [p1(1-p1) + p2(1-p2)] / (p1-p2)²`), with an assumed ~10% baseline booking rate:

| Effect on **booking rate** (10% base) | Sample needed / arm | Time at 200/wk total | Time at 50/wk total |
|---|---|---|---|
| +20% relative (10% -> 12%) | ~3,800 | ~38 weeks | ~150 weeks |
| +30% relative (10% -> 13%) | ~1,800 | ~18 weeks | ~71 weeks |
| +50% relative (10% -> 15%) | ~680 | ~7 weeks | ~27 weeks |
| x2 (10% -> 20%) | ~196 | ~2 weeks | ~8 weeks |

**Reading this honestly:** at this volume, a booking-rate test only powers a **near-doubling** in a
reasonable window. A real-but-modest 20-30% improvement is statistically invisible here for months.
That is not a tooling problem, it is a sample-size floor.

**Why pair it with reply rate.** Reply rate has a much higher base rate (call it ~35%), and for the
**same relative lift** a higher base rate needs far fewer samples (because the required sample scales
with `(1-p)/p`):

| Effect on **reply rate** (35% base) | Sample needed / arm | Time at 200/wk total | Time at 50/wk total |
|---|---|---|---|
| +20% relative | ~750 | ~7 weeks | ~30 weeks |
| +30% relative | ~340 | ~3 weeks | ~14 weeks |
| +50% relative | ~120 | ~1 week | ~5 weeks |

So within a sensible ~4-week box at the upper end of moderate volume, reply rate can detect ~30%
relative swings while booking rate can only detect near-doublings. **Recommendation:** keep
**booking rate as the decision metric** (it is what the business cares about), but read **reply rate
as the fast leading indicator** to kill obviously-losing arms early and to give a directional signal
long before booking rate is conclusive. Track `cost_per_booking` and show rate as secondary context.

**Method guidance to bake into the design (not just the dashboard):**
- **Pre-commit a stopping rule** (a fixed sample-per-arm or a fixed time box) before the test
  starts. Store it on `ab_test_groups` (`min_sample_per_arm`, or a deadline). The temptation to
  "peek and stop when it looks good" inflates false positives badly at low volume.
- **Test bold hypotheses only.** At this volume, only large structural differences are worth a test.
  Put a guard rail in the UI copy: "tests detect big swings, not micro-tweaks."
- **Frame results as a better bet, not proof.** Below the powered sample, the dashboard should label
  a leader as "ahead, not yet conclusive" with the current sample vs the pre-committed target, so a
  decision to ship the leader is an informed bet rather than a claimed win.
- **Optional later:** a Bayesian "probability arm A beats arm B" read is friendlier than p-values at
  low volume and degrades gracefully, but it does not manufacture signal that the sample size lacks.
  Defer unless the simple view proves confusing.

**Viability verdict on the statistics:** worth building because (1) campaign-level structural tests
produce large effects that this volume *can* resolve, and (2) the reply-rate leading indicator keeps
tests useful in weeks rather than months. Not worth building a fine-grained copy-variant machine
(3.1c) until volume is materially higher.

---

## 8. (e) The report-only prompt rule and how it constrains agent-variant rollout

The hard project rule: **voice-agent prompt content is Brendan's to apply via the BFD setter UI;
the system never edits or auto-promotes a voice prompt**
([CLAUDE.md "Voice Agent Prompts: Do Not Edit, Report Only"], and
[NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md](archive/NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md#L64)). A/B
testing must be designed around this, not against it. Concretely:

- **Rotation between existing setters is fine.** Brendan builds "variant B" in the UI (the Try-Gary
  clone already mints a second setter slot he can edit). The A/B system only **routes** between two
  setters that already exist and **measures** the outcome. It never touches prompt text. This keeps
  3.1b fully inside the rule.
- **Winner promotion is a UI action, not an automated one.** When a voice arm wins, the system
  surfaces "Variant B is ahead on booking rate" and Brendan promotes it (points the campaign at it,
  retires the loser) through the BFD setter UI. No backend prompt write, no Retell PATCH/publish by
  the system.
- **The AI-evaluation loop proposes, never applies (for voice).** Phase-2 suggestions like "test a
  warmer opener against the current persona" are **report-only recommendations**. Brendan authors
  the actual variant prompt and applies it. The loop may draft suggested wording for him to paste,
  but it does not write it into Retell or the repo prompt files.
- **SMS / system-generated copy is softer, still surfaced.** AI-generated SMS variants (3.1c) are
  system copy, not a Retell voice prompt, so the rule is less absolute there. Even so, treat
  auto-generated cadence copy as campaign config Brendan owns: the system may generate and test
  variants, but a winning copy change should still surface for his confirmation rather than silently
  rewriting a live cadence.

**Design implication:** the A/B engine needs a clean separation between **assignment/measurement**
(fully automatable) and **content changes** (proposed by the system, applied by Brendan). The arm
stamp, resolver rotation, and dashboard are all on the automatable side. Anything that mutates a
voice prompt stays on Brendan's side of the line.

---

## 9. The AI-evaluation loop (Phase 2)

The kickoff brief's second phase: on a schedule, an AI reads the running test's results, judges the
winner, and proposes the next test, forming an iterative optimization loop
([NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md](archive/NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md#L53-L57)).

- **What it reads:** the per-arm comparison from section 6 (`cadence_metrics` grouped by arm),
  enrolment counts, the pre-committed sample/time target, and the booking-rate + reply-rate splits.
- **How it judges significance vs noise:** it applies the same two-proportion logic as section 7 (or
  a Bayesian probability-to-beat). Crucially it must report **"not yet conclusive, X of Y target
  sample"** rather than declaring a winner on a handful of bookings. The low-volume reality means
  most weekly reads will be "keep running"; that is the correct, honest output.
- **Cadence:** recommend a **weekly read** (a short status: arm standings, sample progress, any
  early kill signal from reply rate) and a **monthly decision** (promote / conclude / start the next
  test). Weekly matches how fast reply rate moves; monthly matches how slowly booking rate
  accumulates. Reuse the existing scheduled-task infrastructure (Trigger.dev) rather than inventing
  a new scheduler.
- **How suggestions surface:** **report-only**. The loop writes a suggestion record (proposed
  action + rationale + the data it saw) that appears in the UI for Brendan. It promotes nothing
  automatically. For voice, it can draft suggested prompt wording but Brendan applies it via the
  setter UI (section 8).
- **Build position:** last. The loop is only worth building once at least one A/B level is running
  and measurable (it has nothing to read otherwise), and its judgments are only trustworthy once
  there is enough volume to reach the powered samples in section 7.

---

## 10. Blast radius and risk

- **Resolver change (3.1a):** the riskiest single touch, because the resolver is on the **live
  inbound main-form path** for every client. Mitigations: the A/B branch only fires when a tag maps
  to a **running** `ab_test_groups` row; with zero groups, the resolver behaves exactly as today
  (first-match). The pure decision functions are already unit-tested
  ([resolve-workflow.test.ts](frontend/supabase/functions/_shared/resolve-workflow.test.ts)), so the
  rotation logic can be added test-first. Keep the default path a literal early return.
- **Index relaxation (3.1a):** choosing "group owns the tag" means the existing partial unique index
  is **not modified at all** (member workflows carry `NULL` tags), which removes the migration risk
  entirely. Prefer this over widening the index.
- **Arm stamp (3.1b/c):** additive nullable column; null = current behavior. No backfill, no change
  to existing reads. Low risk.
- **Analytics:** the comparison view is read-only and additive; it does not touch the existing
  `compute-analytics` path
  ([compute-analytics/index.ts](frontend/supabase/functions/compute-analytics/index.ts)), which
  remains variant-unaware. No regression surface there.
- **UI:** grouping campaigns and a comparison panel are net-new screens; they do not alter the
  single-campaign flows. The main risk is user confusion (treating an underpowered leader as a
  proven winner), addressed by the "ahead, not conclusive" labeling in section 7.
- **Voice content:** zero automated prompt mutation by design (section 8), so the highest-churn-risk
  area in this codebase (live Retell prompts) is untouched by the A/B engine.

---

## 11. Recommended phased build order and effort

| Phase | Scope | Key work | Effort |
|---|---|---|---|
| **1: 3.1a campaign-level** | Two workflows share a tag, split + compare | `ab_test_groups` table, group-owns-tag model (no index change), resolver rotation (sticky-by-lead), grouping UI + side-by-side `workflow_id` comparison view | **M, ~3-4 days** |
| **2: arm stamp + 3.1b agent-level** | Compare two setters inside one campaign | `variant` column on `engagement_executions` + `cadence_metrics`, optional `ab_assignments`, per-campaign/per-node variant picker (reuse Try-Gary clone + Retell weighted lists), extend comparison to `GROUP BY variant` | **M-L, ~4-6 days** |
| **3: 3.1c AI-variant + Phase-2 loop** | Auto-generated copy variants + scheduled AI reviewer | Generate + persist N variants from `aiGenerateEngagementCopy`, scheduled weekly-read / monthly-decision task, report-only suggestion surface | **L, ~5-8 days, deferred** |

**Sequencing rationale:** Phase 1 ships the most valuable test (whole-cadence structural swings,
which are the only thing this volume can resolve quickly) with the least new attribution code,
because campaign-level results are already separable by `workflow_id`. Phase 2 adds the one column
that unlocks every within-workflow test and reuses the clone + weighted lists already in the tree.
Phase 3 and the AI loop wait until there is both the measurement foundation and enough volume to
justify fine-grained, machine-driven optimization.

**Overall recommendation:** GO on Phase 1 as a dedicated build, GO on Phase 2 when a client actually
wants to A/B personas, DEFER Phase 3 until volume materially exceeds 200/week or multiple clients
are pooled. This matches the ROADMAP's own "MODERATE difficulty, defer to a dedicated build,
do it properly with sticky-by-lead and a clean comparison dashboard" conclusion
([ROADMAP.md](ROADMAP.md#L177)), and sharpens it with the volume-driven metric strategy.

---

## 12. Appendix

### Citation index
- A/B design + constraints + difficulty: [Docs/ROADMAP.md](ROADMAP.md#L163-L177)
- Two-phase brief (setup + AI-eval loop), report-only rule, statistical-validity ask:
  [Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md](archive/NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md#L45-L67)
- Sequencing (research -> 3.1a -> 3.1b -> 3.1c):
  [Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md](archive/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md#L54)
- Tag resolver (first-match):
  [resolve-workflow.ts](frontend/supabase/functions/_shared/resolve-workflow.ts#L37-L47)
- One-workflow-per-tag partial unique index:
  [20260530120000_form_routing_multi_new_leads.sql](frontend/supabase/migrations/20260530120000_form_routing_multi_new_leads.sql#L22-L24)
- Per-campaign text setter resolution: [runEngagement.ts](trigger/runEngagement.ts#L909-L917)
- Per-node voice setter + override resolution: [runEngagement.ts](trigger/runEngagement.ts#L1135-L1180)
- Setter clone (variant creation):
  [duplicate-setter-config/index.ts](frontend/supabase/functions/duplicate-setter-config/index.ts)
- Retell weighted agent lists:
  [retell-proxy/index.ts](frontend/supabase/functions/retell-proxy/index.ts#L265-L385)
- `cadence_metrics` DDL:
  [20260430120000_phase7a_tracking_schema.sql](frontend/supabase/migrations/20260430120000_phase7a_tracking_schema.sql)
  + cost columns
  [20260513150000_cadence_v2_day3_email_metrics.sql](frontend/supabase/migrations/20260513150000_cadence_v2_day3_email_metrics.sql)
- AI copy generation (ephemeral, unstamped):
  [aiGenerateEngagementCopy.ts](trigger/_shared/aiGenerateEngagementCopy.ts)
- Voice prompt report-only rule: [CLAUDE.md](../CLAUDE.md) ("Voice Agent Prompts: Do Not Edit")

### Statistical method note (reproducible)
Sample sizes use the two-proportion normal approximation at 80% power, two-sided alpha = 0.05:
`n_per_arm ≈ 7.84 · [p1(1-p1) + p2(1-p2)] / (p1-p2)²`, where 7.84 = (1.96 + 0.84)². Booking rows
use a 10% baseline; reply rows use a 35% baseline. Weeks-to-power divide by 25/arm/week (50/week
total) and 100/arm/week (200/week total). These are planning estimates, not a substitute for a power
calculation against the client's observed base rate once data exists.

### Open questions for Brendan
1. Is the first real use BFD's own funnel, or a multi-client feature from day one? (Affects whether
   cross-client pooling to reach significance faster is worth designing for, with its confound
   caveats.)
2. For Phase 1, is the first concrete test a **framework** swing (text-only vs text+call) or a
   **timing** swing? The first test should be a bold hypothesis to have any chance of resolving on
   booking rate at this volume.
3. Should the comparison dashboard expose a Bayesian "probability A beats B" read, or stay with the
   simple "ahead / not conclusive vs target sample" framing for v1?
