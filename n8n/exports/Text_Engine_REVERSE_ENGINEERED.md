# n8n `Text_Engine` workflow — reverse-engineered I/O contract

> Generated 2026-04-30 by reading the only client of n8n's text-engine webhook in our codebase: `trigger/processMessages.ts:204-282`. This is the contract Phase 1's `processSetterReply.ts` MUST satisfy. **Brendan should still export the live `Text_Engine.json` from n8n's UI when convenient** — that gives Phase 1 the internal logic (system prompt construction, model selection, multi-message parsing). This doc gives the request/response shape with full fidelity, which is enough to build a passing native port.

## Caller

[trigger/processMessages.ts:204-282](../../trigger/processMessages.ts#L204) is the ONLY caller. Inside the `process-messages` Trigger.dev task:

```ts
const n8nParams = new URLSearchParams({
  Message_Body:    groupedMessage,    // joined inbound message bodies (debounce-grouped)
  Lead_ID:         lead_id,           // GHL contact id (text)
  Contact_ID:      lead_id,           // n8n's getGHL_Conversations node expects Contact_ID alongside Lead_ID — same value
  GHL_Account_ID:  ghl_account_id,    // GHL location id
  Name:            contact_name ?? "",
  Email:           contact_email ?? "",
  Phone:           contact_phone ?? "",
  Setter_Number:   setter_number || "1",
});

await fetch(`${client.text_engine_webhook}?${n8nParams.toString()}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  // body is EMPTY — all params are in query string
  signal: abortControllerWith10MinTimeout,
});
```

## Request

| Field | Type | Source | Notes |
|---|---|---|---|
| `Message_Body` | string | grouped message_queue rows for the lead within the debounce window | Multiple inbound texts within the debounce concatenate via newlines |
| `Lead_ID` | string | GHL contact id | text, NOT a UUID |
| `Contact_ID` | string | same value as Lead_ID | n8n's `getGHL_Conversations` node reads this field name specifically |
| `GHL_Account_ID` | string | GHL location id | e.g. `xo0XjmenBBJxJgSnAdyM` for BFD |
| `Name` | string | full name, may be empty | derived from leads.first_name + last_name |
| `Email` | string, may be empty | from leads.email | |
| `Phone` | string, may be empty | E.164 like `+61400000000` | |
| `Setter_Number` | string `"1"` \| `"2"` \| ... | which setter slot (1-3 today) | Defaults to `"1"` if unset |

URL: `client.text_engine_webhook` — for BFD this is `https://primary-production-392b.up.railway.app/webhook/n8n-ai-lead-setter`.

Method: `POST`. Content-Type: `application/json`. Body: empty (all data in query string).

Timeout: 10 minutes (n8n's reply path can take up to 5 minutes for complex tools/RAG).

## Response

JSON body. Required:

| Field | Type | Required | Notes |
|---|---|---|---|
| `Message_1` | string | YES — error if missing | First reply message |
| `Message_2` | string | optional | Second reply (sent after a small delay) |
| `Message_N` | string | optional | Walked in order until first missing index |

Validation done by [processMessages.ts:262-278](../../trigger/processMessages.ts#L262):

```ts
if (!responseObj.Message_1) {
  throw new Error("n8n response missing required field 'Message_1'");
}
let i = 1;
while (responseObj[`Message_${i}`]) {
  setterMessages.push(String(responseObj[`Message_${i}`]));
  i++;
}
```

After parsing, processMessages forwards the WHOLE JSON response to GHL via `client.ghl_send_setter_reply_webhook_url?Contact_ID={lead_id}` (POST). For native path we'd skip this hop and Twilio outbound directly.

## What n8n's internal nodes are doing (inferred, NOT verified)

Based on field names referenced (Contact_ID for `getGHL_Conversations`), node naming conventions, and typical setter-AI workflow patterns:

1. **Webhook trigger** — receives the POST + query params
2. **Get GHL conversation** — fetches conversation history for the contact (uses `Contact_ID`)
3. **Get setter prompt** — reads the prompt for `Setter_Number` from `bfd-setter-live.text_prompts` (or analogous)
4. **OpenRouter / OpenAI call** — system prompt = setter prompt + context, user prompt = chat_history + new Message_Body
5. **Parse multi-message output** — likely splits the LLM output on a delimiter (`\n---\n` is conventional, but could be numbered) into Message_1, Message_2, ...
6. **Append to chat_history** — writes the assistant message back so next turn has context
7. **Respond to webhook** — returns the parsed JSON

The setter prompt + chat_history + multi-message parsing logic is what Phase 1's `processSetterReply.ts` needs to replicate. If Brendan exports the actual JSON we get the system-prompt template + delimiter convention exactly. Without it, the port replicates from `trigger/sendFollowup.ts` (already does this pattern) plus inspection of recent BFD `chat_history` rows to infer the delimiter.

## Where the prompt + history live

Confirmed by Phase 1 plan + memory:

- Setter prompt: `bfd-setter-live.text_prompts` — per-client mirror Supabase
- Chat history: `bfd-setter-live.chat_history`, `session_id = Lead_ID` — same DB
- Client OpenRouter key: `clients.openrouter_api_key` (bfd-platform)
- Client model preference: `clients.llm_model` (bfd-platform; e.g. `openai/gpt-5-mini`)

## Sample probe (when needed, max ~$0.01 OpenRouter spend)

To capture a real n8n response shape (delimiter + multi-message conventions), the new session can run:

```ts
const params = new URLSearchParams({
  Message_Body: "test inbound from new claude session",
  Lead_ID: "TESTLEAD_<short_uuid>",
  Contact_ID: "TESTLEAD_<short_uuid>",
  GHL_Account_ID: "xo0XjmenBBJxJgSnAdyM",
  Name: "Test Lead",
  Email: "",
  Phone: "+61400000000",
  Setter_Number: "1",
});
const r = await fetch(`https://primary-production-392b.up.railway.app/webhook/n8n-ai-lead-setter?${params}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
});
console.log(await r.json());
```

⚠ This will:
- Spend ~$0.01 OpenRouter tokens on BFD's account
- Append a row to `bfd-setter-live.chat_history` (cleanup: `DELETE FROM chat_history WHERE session_id = 'TESTLEAD_<id>'`)
- Possibly attempt outbound SMS if n8n's flow goes that far (set `Phone` to a known-test number to be safe, or use a sentinel like `+61400000000`)

Use sparingly — once is enough to capture the response shape.

## Phase 1 implementation plan

Reference [trigger/sendFollowup.ts:11-29, 129](../../trigger/sendFollowup.ts#L11) — already does setter prompt + OpenRouter + structured response.

`trigger/processSetterReply.ts` task signature:

```ts
export const processSetterReply = task({
  id: "process-setter-reply",
  maxDuration: 600,
  retry: { maxAttempts: 2 },

  run: async (payload: {
    Message_Body: string;
    Lead_ID: string;
    Contact_ID: string;
    GHL_Account_ID: string;
    Name: string;
    Email: string;
    Phone: string;
    Setter_Number: string;
  }) => {
    // 1. Resolve client by ghl_location_id = GHL_Account_ID
    // 2. Open client mirror Supabase (supabase_url + supabase_service_key)
    // 3. Fetch setter prompt from text_prompts (Setter_Number → slot lookup)
    // 4. Fetch chat_history WHERE session_id = Lead_ID, last 30 messages
    // 5. Build system prompt: setter prompt + injected variables (Name, Phone, Email)
    // 6. Build messages array: chat_history → user message: Message_Body
    // 7. POST OpenRouter chat/completions:
    //    model: client.llm_model || 'openai/gpt-4.1-nano'
    //    messages: built array
    //    Headers: Authorization: Bearer client.openrouter_api_key
    // 8. Parse response — split on delimiter into Message_1, Message_2, ...
    // 9. Append assistant message to chat_history
    // 10. Return { Message_1, Message_2?, ... } same shape as n8n
  }
});
```

Branch in [processMessages.ts:211-218](../../trigger/processMessages.ts#L211):

```ts
let n8nResponseData: unknown;
if (client.use_native_text_engine) {
  const result = await processSetterReply.triggerAndWait({
    Message_Body: groupedMessage,
    Lead_ID: lead_id,
    Contact_ID: lead_id,
    GHL_Account_ID: ghl_account_id,
    Name: contact_name ?? "",
    Email: contact_email ?? "",
    Phone: contact_phone ?? "",
    Setter_Number: setter_number || "1",
  });
  if (!result.ok) throw new Error("processSetterReply failed: " + (result.error?.message ?? "unknown"));
  n8nResponseData = result.output;
} else {
  // existing fetch to client.text_engine_webhook (unchanged)
}
```

Output validation stays identical (`Message_1` required, walk indexes). Forward-to-GHL hop stays unchanged for now — phase 9 cuts it over.
