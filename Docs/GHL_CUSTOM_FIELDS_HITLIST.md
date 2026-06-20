# GHL Custom Fields — Hit List (BFD location `xo0XjmenBBJxJgSnAdyM`)

Audit 2026-06-19. **~116 fields total → 6 KEEP, 9 KEEP-for-6.12, ~101 probably-delete.** Most are leftover from the upstream 1prompt template / old n8n / demo forms. Verify against any live GHL workflows before mass-deleting; the GHL-sync session (6.12) should finalize the KEEP/wire set.

## ✅ KEEP — actively used by BFD-setter (6)
| id | name | why |
|---|---|---|
| `jWPaRl6ysDgR7KWzW89d` | Setter Call Sentiment | written by retell-call-analysis-webhook (created 2026-06-19) |
| `IJVbAhkWv94dRW6Ddnze` | Setter Appointment Booked | written by retell-call-analysis-webhook (created 2026-06-19) |
| `PQNTqtTnIw9Uu0XLLE5M` | last_synced_from | echo-loop guard (push-contact-to-ghl + sync-ghl-contact) |
| `p0vCIz497xZLk5fUSF0X` | Channel | set by receive-twilio-sms |
| `ihlAeIHF4D47wyhBs2xa` | Agent style preference | Try-Gary / persona routing |
| `tvt7Txd1udUErMwOzpaU` | GHL Account ID | contact identity in sync-ghl-contact |

## 🟦 KEEP-for-6.12 — outcome fields the GHL writeback SHOULD populate (9)
`YD9wo2UYpfsewexEExb6` Call Outcome · `sbwpZdkcp1OxoAwffLEA` AI Call Summary · `ZOpyG5eQLYdNeXA7UW9w` Call Intent · `nMV3jNAZIZyrclc6H5N3` Appointment Booked · `zoNSLEjOucDtumqREGoG` Lead Qualified · `9rtxGevOeSiJZpD3zFfi` Last Call Date · `qvA1ZKUP2QcwffoTR8DS` Callback Requested · `hZxMXCpQM1JTvdSbsV79` Callback Datetime · `Yu0pBpa0X99NjJbiWa2X` Appointment Datetime
> The 6.12 session decides whether to use these existing fields or the dedicated `Setter *` TEXT fields (note: `Sentiment`/`Appointment Booked` here are SINGLE_OPTIONS/CHECKBOX, which is why the dedicated TEXT fields were created — see `project_ghl_duplicate_contacts_split_2026_06_18`).

## 🔴 SECURITY — delete + verify not populated (2)
`6uO14dISilgbMcn35Ne4` **Supabase Service Role Key** · `eRGxS6OZhW20KLxP2c1n` **Supabase Project URL** — secrets/config must NOT live in CRM fields. → Bug 6.13.

## 🗑️ PROBABLY DELETE (~101) — grouped for easy action
- **Old n8n webhooks (3):** `31TsSKizXYlMAXHK0sYk` Outbound Caller Webhook 3 · `K4xJ7NO9Zc319iegCcQg` Webhook 1 · `Z6PZyaER3qKEiujAzRll` Webhook 2 · plus generic `INSX1Tx9nvy9QpoHHXan` Webhook 1, `tZOyiH7VcnS5tjKPrjWZ` Webhook 2
- **Legacy Call History (3):** `UcWcMoQRyLBswAURMiqv` Call History 1 · `9rpTayp9RWbf4tQ4ovO1` 2 · `gKRBFjYdx7CHAo2UYYt3` 3 (use the `call_history` table)
- **Redundant/legacy outcome (5):** `EDDIHRUoeQAum6ujKd3w` Sentiment (SINGLE_OPTIONS dup) · `MVXNxk38j9z7AsLv4ptp` last_call_outcome · `K1JXFWFBCS1MLvU6UKdo` Lead Qualification Score · `qfGpRtQwPoXN2mPgG9bS` Objections Raised · `dR7phg45NsShAbOJl2Xw` Property Preferences
- **Demo qualification (1prompt) (~14):** `1HYHkzIkazCMm4ZrgA8a` $6k Investment · `llqCVvuvflt2P5vNrgja` 4-Figure Investment · `0FqwAdSja5zYMOhyyMys` Clients Acquisition · `1UFhh9jxoj45UWMPkyYE` Use Case · `nVlv5XfNP32kVeIEKoPR` Coach Problem · `bqBt6tnAPQ8hrbpNuMEI` Goal · `v8weIK3sOS3NBjnRl0Go` Problem · `vYCLH2B2gQgEKnzIZgmg` Solve Problem · `4DIyLFKbXpZecbK9SYXs` What's your interest? · `5QcUmxUQzhCJHSvyPnZB` Lead Score · `YffyiCvYjKBZK0RgCzHk` Has Clients · `vYmsk5HqPSnRw2DPin5Q` Client Amount · `yCN6NcMwPrV0oZp3PmTJ` Marketing Spend · `uM9hSTdiaY7NQl7r6VbJ` Use or Sell
- **Legacy form responses (7):** `nDSRAHppt8iABIF2uvDt` Response1 … `n0aBtSItemwQ1ITwGqzV` Response5 · `9Aeb7ISW9ipjgBasOnfO` Follow Up · `7QLHHRHvilBUPQfEV7Rb` Next Steps
- **UTM/attribution (3):** `0Qi9M5Yj4uJmaBl4V3Dg` UTM medium · `A2POMFRkY8tUl9mTq763` UTM campaign · `tac8ClhiZi8OIRTUlzkr` UTM source (GHL has standard attribution)
- **Demo DM templates (6):** `3niTf67bFdI27MgRsy0T` DM1 … `wK1NSbtaIvUrS4i5Idzs` DM5 · `jIabtDFIFUqw9Z1C5EA2` DMBody
- **Recording/transcript dups (7):** `R4L7NK6DzV3UV4X2PfNG` Recording URL · `VUZECUanrfLOWxvommvh` Transcript · `V8xaahSYyNPxxC0xIysl` Transcript Summary · `tVXRleT24kntiOrAVoIa` Recording · `FrgMSr0z2JM5jPYCeTp1` Snapshot · `w8vgEnm6GIqAuqc5EDge` Webinar Replay URL · `uhjokUUy2vHZaRCYFem7` Webinar Replay for WhatsApp (recordings live in `call_history`)
- **Chat/email legacy (5):** `lB00oi2ijdC2pCyxazrJ` Chat ID · `fMOYW5rBDAVQCxKDXlXJ` emailThreadId · `F002iMAQqULMi6FrBJMp` EmailContent · `RnOdwlK5Ep8LNAita3Uk` chatHistory · `YweditifdYqxAfnq6kxI` Reply Message
- **Webinar (4):** `Gg2j7iyDpHYwEK5umUxn` Webinar Join URL · `ZeZvaalKfp38J04mD7oh` Time Spent · `jU1P5eyqdoXuTPRSyKVZ` Time Category · `hxGRpYa7AnaznU8imBgq` YouTube Learning Video
- **1prompt account (4):** `CgFsgeRttBoRZMoYpfmX` Main 1Prompt Email · `RKWomyey6VHx3OTJ5KOk` Upload Snapshot · `rswHoEtYLSOV7iptmls2` Sub-Account Owner · `tYZby9HlowuoxSom4bt2` Skool ID
- **WhatsApp routing (2):** `KgNyQoDx3Nsv058x68Vj` CTA for WhatsApp · `lYsfNhK6r1Cqf2kt8Dd3` Question for WhatsApp
- **Business-profile dups (use GHL standard) (~12):** Business Description/Type ×2, Company Description, Revenue ×2, Employees, Marketing Spend, Money, No Money, Occupation, LinkedIn Profile, Full Address, Communication
- **Retry/scheduling config (should be DB, not CRM) (~7):** `JY2CWhcpZgVAEIRaDnez` next_call_time · `Ris7xA2k4elSbSrUZeqn` Max Retry Attempts · `WUxfX8at6D1HJnn79qNY` retry_schedule · `r3ulrHpuguvEYg6RS6IG` call_attempt_count · `OxWBnPoSlok6hrAH4xWa` Setter Number · `p1kOVmKofXLPdFZZL4Y8` Last Call Direction · `7Hw7StDIEFe8YOCEW9cc` Duration
- **Misc undefined (~16):** Where Found, Import Date, Ended Reason, Meeting Link, Booking LInk, MasterMessage, Cost, Provider ID, Public ID, Multi Dropdown 4uqg (test), No Rebookings, Priority, Consent text version, Lead Score, Snapshot, etc.

**Action order:** 6.13 security fields first → old n8n/webhook → demo/quiz/DM templates → recording/transcript/webinar dups → business-profile dups → retry-config. Keep the KEEP + KEEP-for-6.12 sets. Confirm no live GHL workflow references a field before deleting it.
