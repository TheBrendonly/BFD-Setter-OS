# Retell Pivot Verdict — 2026-08-12

**Verdict up front: HALF PIVOT — as an operating practice, not a build.** The code the half-pivot needs is ~90% already in your repo. The full pivot is rejected. Detail in §4.

> **Post-review status (same day):** Brendan ratified the half-pivot as the standard voice-persona
> workflow, greenlit the snapshot slice + voice→text transform as a one-off overnight build, and
> backlogged the Modify-with-AI button fix. See `Docs/RETELL_PIVOT_DECISION_2026-08-12.md` (the
> decision record) and `Docs/OVERNIGHT_RUN_2026-08-12.md` (the build spec). The "avoidance" framing
> in §4 below was softened in discussion — Brendan's refined workflow (templates pushed from BFD →
> Conductor shaping → tweak/QA → pull) was accepted as exactly the half-pivot this report recommends.

---

## 1. What Retell actually ships today (verified 2026-08-12)

| Capability | Status | Evidence |
|---|---|---|
| Agent templates | **Yes — dashboard only.** "Build from scratch / prebuilt template / Generate from prompt" on agent create. **No template API** — nothing in the API surface. | [Quick-start](https://docs.retellai.com/get-started/quick-start), [API index](https://docs.retellai.com/llms.txt) |
| AI prompt tooling | **Yes — "Conductor"** (launched 2026-06-29, expanded 2026-07-02): builds agents from plain English, edits live agents with review, simulated testing, failed-call issue detection. **Dashboard-native, no API access.** Free tier is token-metered (4k tokens). | [Conductor blog](https://www.retellai.com/blog/introducing-conductor), [Changelog](https://www.retellai.com/changelog) |
| Knowledge bases | Yes — KB 2.0 (Jul 2025), node-level KBs (Sep 2025), full CRUD API | [KB docs](https://docs.retellai.com/build/knowledge-base) |
| Conversation flow vs single prompt | Both. CF has full CRUD API + reusable sub-flow components (Nov 2025). Retell positions CF as "for production use". | [Quick-start](https://docs.retellai.com/get-started/quick-start) |
| Versioning / publishing | Strong: draft/publish, `create-agent-version`, `publish-agent-version`, `get-agent-versions`; published versions immutable; Versioning 2.0 staging/prod (May 2026); A/B testing (Mar 2026) | [Changelog](https://www.retellai.com/changelog), [get-agent](https://docs.retellai.com/api-references/get-agent) |
| Tool/function libraries | Tools live **on the LLM object** (`general_tools`, per-state tools): custom HTTP, Cal.com booking, transfer, send_sms, agent_swap, MCP nodes. No shared cross-agent tool library. | [get-retell-llm](https://docs.retellai.com/api-references/get-retell-llm) |
| Dynamic variables | Yes — system defaults, per-LLM defaults, real-time extraction (Jul 2025) | [Changelog](https://www.retellai.com/changelog) |
| Multi-agent handoff | Yes — Agent Transfer (Jul 2025), warm transfer w/ handoff assistant (Dec 2025) | [Changelog](https://www.retellai.com/changelog) |
| Batch calling | Yes — `create-batch-call` API + scheduling windows (Sep 2025) | [API index](https://docs.retellai.com/llms.txt) |
| Agent CRUD API | Complete: create/get/list/update/delete for agents, retell-llms, conversation flows, chat agents. **No duplicate endpoint** — duplication is get→create (what `duplicate-setter-config` does). Dashboard import/export across orgs (Feb 2025). | [API index](https://docs.retellai.com/llms.txt) |
| **SMS** | Two-way SMS chat agents exist (Aug 2025) + `create-sms-chat` API. **But A2P 10DLC is US-numbers-only** and there are **no drip cadences / scheduled sequences at all**. | [SMS docs](https://docs.retellai.com/deploy/enable-sms) |
| Multi-tenancy | **None client-facing.** RBAC (Sep 2025) is org-wide roles, not per-client boundaries. A third-party white-label ecosystem (Voicemetrics, VoiceAIWrapper, Trillet) exists precisely because Retell's dashboard can't be handed to clients. BFD-setter IS one of those wrappers. | Search, changelog |

### Assumptions corrected

1. **"Retell doesn't run SMS cadences" — right, and worse:** Retell SMS is US-A2P-only. For AU clients it's unusable, full stop. The text engine is the only SMS path BFD can ever have on Retell.
2. **"Retell's AI tooling can shape the agent" — true but dashboard-only.** Conductor has no API; it can never be part of automated onboarding.
3. **"Pull it back as stored known-good config" — already built** (F9: `pull-retell-config`, `set-setter-lock`, `pollRetellDrift`). But the snapshot was THIN (presence/char-count, tool names) — drift detector, not a restore. → fixed by the 2026-08-12 overnight build.
4. **Proposal steps 2, 3 and 6 already existed:** template library + `sync-voice-setter` push (with booking-tool injection, publish, phone repointing), `duplicate-setter-config`, cross-channel copy.

## 2. Component audit — keep / shrink / retire

| Component | Lines | Call | Reason |
|---|---|---|---|
| `retell-proxy/index.ts` | 2,061 | **KEEP** | It IS the pivot's engine: push/pull/lock/publish/repoint/booking-tool injection |
| `PromptManagement.tsx` | 8,544 | **KEEP, shrink later** | Slot↔client↔agent wiring, lock/pull/drift UI; section-editor tabs can go post-pilot |
| `AgentConfigBuilder.tsx` | 5,400 | **SHRINK → freeze** | Already setup-only since doc model (2026-06-12) |
| `voiceSetterConfigParameters.ts` | 1,649 | **SHRINK with above** | Powers section editor + cross-channel adaptation |
| `VoiceRetellSettings.tsx` | 1,476 | **SHRINK** (keep ToolsEditor) | Retell dashboard does the sliders; per-client tool wiring stays |
| `defaultPromptTemplates.ts` | 1,235 | **KEEP** | The template library — step 2 of the proposal itself |
| `MiniPromptAIDialog.tsx` | 857 | **SHRINK** | Conductor replaces voice path; TEXT path stays (Conductor can't author text) |
| `PersonalityConstructor.tsx` | 729 | **RETIRE — dead code** | Zero imports; only a comment references it (`AgentConfigBuilder.tsx:27`) |
| `PromptDocPage.tsx` | 456 | **KEEP** | Canonical doc-model editor + push + CF outline |
| `SetterParameterField.tsx` | 437 | **SHRINK with builder** | Field renderer |
| `AIPromptDialog.tsx` | 418 | **KEEP** (broken button backlogged) | Text prompts need it; dead env var since 2026-05-19 |
| `duplicate-setter-config` | 328 | **KEEP** | Slot duplication, no Retell equivalent |
| `save-external-prompt` | 314 | **KEEP** | Text engine reads its output verbatim at runtime |
| `PromptAIChatPanel.tsx` | 307 | **SHRINK** | Voice path post-pilot; text stays |
| `modify-prompt-ai` | 293 | **SHRINK** | Section-structure preservation still needed for text |
| `get-external-prompt` | 106 | **KEEP** | X-ray exists because divergence caused a wrong live booking |

**Arithmetic:** deletable today = 729 lines (dead code). Post-pilot ≈ 2,500–4,000 more. The two
biggest files are what the pivot needs. This was never a 24,000-line retirement.

## 3. The six decision questions (condensed)

1. **Multi-tenancy:** clients never author prompts (managed service; SOPs enforce it) — nothing
   sold is lost. The platform's real value is OPERATOR safety (tenant checks, locks, lint, diff
   review); Retell's dashboard is one flat org. Acceptable iff BFD stays system of record + F9
   lock governs ownership. That is the shipped architecture.
2. **Text agent:** can never be Retell (US-only SMS, no cadences; `processMessages` hard-requires
   the native engine). Voice→text is a BFD-side transformation; free-text Conductor prompts make
   the parameter-based copy lossy → the AI transform built 2026-08-12 closes this.
3. **Pull-back fidelity:** API-complete (`get-agent` + `get-retell-llm` + CF endpoints return
   everything; published versions immutable). Lost on round-trip: KB source files, Conductor
   chat/test artifacts, A/B configs, dashboard-first features pre-API. Schema churn is monthly →
   snapshot is schema-stamped and restore strips unknown fields.
4. **Lock-in:** BFD DB as source of truth keeps the exit door open (re-push elsewhere). Adopting
   conversation flows deepens lock-in (proprietary graphs). At 0 clients the cost is near zero
   but compounds per client. The snapshot-in-DB is the free hedge.
5. **Must stay BFD-native:** booking tool injection (per-client URLs/secrets), SMS engine +
   STOP/quiet-hours/opt-outs, lead ingress, metering/billing, tenant boundary + credential vault,
   phone/version plumbing, drift monitor, compliance review process.
6. **Half-pivot vs full:** half-pivot dominates every row (cost ~0, text unchanged, compliance
   gates stay, exit hedge kept, same client story). Ratified.

## 4. Verdict

HALF PIVOT as practice: push template from BFD → F9 lock → Conductor shapes → tweak/QA → pull.
Full pivot rejected (false arithmetic, worse text path, lost compliance gates). Code slices gated
on: first paid pilot, or three consecutive personas where Conductor beats the old path — with the
one ratified exception of the 2026-08-12 overnight build (snapshot fidelity + voice→text
transform + hygiene + docs).

## 5. Three risks to keep pricing

1. **Conductor can't author text — ever.** The AI-editing stack keeps a permanent text-side job;
   every Conductor free-text voice prompt makes voice→text conversion lossier without the
   transform.
2. **Compliance regression by helpful robot.** Conductor's job is "improving" prompts; the AI
   disclosure / recording disclosure / NCCP guardrail must be QA-checked verbatim after every
   dashboard session. Related traps: doc-model push clobbers unlocked slots; dashboard publishes
   don't repoint BFD phone version pins.
3. **Single-account blast radius.** All tenants in one Retell org, org-wide roles, no per-client
   guard in the dashboard. Fine at 1–3 clients under F9 lock discipline; does not scale past that
   without the guardrails staying in the platform.

### Sources

[Retell changelog](https://www.retellai.com/changelog) · [Quick-start](https://docs.retellai.com/get-started/quick-start) · [Introducing Conductor](https://www.retellai.com/blog/introducing-conductor) · [API index](https://docs.retellai.com/llms.txt) · [create-agent](https://docs.retellai.com/api-references/create-agent) · [get-agent](https://docs.retellai.com/api-references/get-agent) · [get-retell-llm](https://docs.retellai.com/api-references/get-retell-llm) · [SMS docs](https://docs.retellai.com/deploy/enable-sms) · [Knowledge base](https://docs.retellai.com/build/knowledge-base) · [Voicemetrics](https://voicemetrics.ai/retell-ai-white-label/) · [VoiceAIWrapper](https://voiceaiwrapper.com/uses/retell-ai-white-label) · [Trillet](https://trillet.ai/blogs/retell-ai-white-label-alternative)

Repo evidence: `retell-proxy/index.ts` (push/pull/lock/publish/repoint), `trigger/pollRetellDrift.ts`,
`PromptDocPage.tsx` (doc-model header), `AgentConfigBuilder.tsx:27` (dead PersonalityConstructor),
`CopySetterDialog.tsx` (cross-channel adaptation), `trigger/processSetterReply.ts:209` +
`trigger/processMessages.ts:112` (text engine), `SOP/CLIENT_ONBOARDING_SOP.md`, `SOP/PERSONA_SETUP.md`,
`SOP/DEMO_PROSPECT_SETUP.md`.
