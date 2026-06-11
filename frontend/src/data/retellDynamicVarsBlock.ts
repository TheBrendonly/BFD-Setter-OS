// DISPLAY-ONLY REPLICA — KEEP IN SYNC with
// supabase/functions/retell-proxy/index.ts DYNAMIC_VARS_BLOCK (~line 577).
// The proxy appends this block to general_prompt at push time (sync-voice-setter);
// the frontend never sends it. It is rendered in the Setter Prompt X-Ray as a
// read-only "added at call time" segment so the TRUE final prompt is visible.
// The template text below (including its em dashes) must stay byte-identical
// to the server's; only `clientTimezone` is interpolated, same as the proxy.

export function buildDynamicVarsBlock(clientTimezone: string): string {
  return `

── ── ── ── ── ── ── ── ── ── ── ── ── ──

## DYNAMIC VARIABLES (auto-injected, available at runtime)

You have access to the following dynamic variables about the lead you are calling. Use them naturally in conversation — do NOT ask the lead for information you already have.

- **Lead First Name**: {{first_name}}
- **Lead Last Name**: {{last_name}}
- **Lead Email**: {{email}}
- **Lead Phone**: {{phone}}
- **Lead Business Name**: {{business_name}}
- **Current Date & Time (${clientTimezone})**: {{current_time}}
- **Caller Timezone (IANA)**: ${clientTimezone}
- **Available Calendar Slots**: {{available_time_slots}}
- **Full Contact Details**: {{user_contact_details}}
- **Custom Instructions**: {{custom_instructions}}

### When dynamic variables are EMPTY (common on inbound calls)

On inbound calls to a BYO Twilio number, Retell does NOT inject dynamic variables — every {{...}} will substitute as empty/literal. If that happens:

1. **Never guess the day-of-week or date.** Do NOT say "tomorrow is Monday" unless you have verified the actual date via a tool call.
2. **To discover today's date**, call \`get-available-slots\` with no \`startDateTime\` — the response is anchored to today in ${clientTimezone}. The first returned slot's date IS today (or the next business hour).
3. **For caller identity** ({{first_name}}, {{email}}), use \`call.from_number\` (auto-injected into tool bodies as \`phone\`) to look up the contact via the contact-lookup tool BEFORE asking the caller their details.
4. **For timezone**, default to ${clientTimezone}. Say "${clientTimezone.split('/').pop()?.replace('_', ' ') || 'local'} time" when confirming bookings.`;
}
