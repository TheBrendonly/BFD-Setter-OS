// One-off: clone the main BFD new-lead cadence into the Try-Gary campaign.
// Clones cadence CONTENT verbatim (messages/instructions untouched) but sets
// every phone_call node's voice_setter_id to a clear TODO sentinel so Brendan
// must confirm which voice agent calls before activating. Target is left
// INACTIVE with its existing tag (bfd_setter-try_gary).
//
//   SUPABASE_PAT=… node scripts/clone_try_gary_cadence.mjs
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Missing SUPABASE_PAT'); process.exit(1); }
const REF = 'bjgrgbgykvjrsuwwruoh';
const SOURCE = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1'; // New-Lead Cadence from Form-Fill
const TARGET = '3fda0794-006e-4285-8e4c-04b9667327c9'; // Try-Gary
const TODO_AGENT = 'TODO-confirm-try-gary-agent';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok) { console.error('SQL error', res.status, JSON.stringify(json)); process.exit(1); }
  return json;
}

// 1. Fetch source nodes.
const [{ nodes }] = await runSql(`select nodes from engagement_workflows where id = '${SOURCE}';`);
if (!Array.isArray(nodes)) { console.error('source nodes not an array'); process.exit(1); }

// 2. Clone verbatim, replacing phone_call voice_setter_id with the TODO sentinel.
let phoneNodes = 0;
const cloned = nodes.map((node) => {
  if (Array.isArray(node.channels)) {
    node.channels = node.channels.map((ch) => {
      if (ch.type === 'phone_call' && 'voice_setter_id' in ch) {
        phoneNodes++;
        return { ...ch, voice_setter_id: TODO_AGENT };
      }
      return ch;
    });
  }
  return node;
});
console.log(`Cloned ${cloned.length} nodes; reset ${phoneNodes} phone_call voice_setter_id -> ${TODO_AGENT}`);

// 3. Update target. Dollar-quote the JSON so single quotes in content are safe.
const jsonLiteral = JSON.stringify(cloned);
const update = `update engagement_workflows
  set nodes = $cadence$${jsonLiteral}$cadence$::jsonb,
      is_active = false,
      new_leads_tag = 'bfd_setter-try_gary',
      is_new_leads_campaign = true,
      updated_at = now()
  where id = '${TARGET}'
  returning id, name, is_active, new_leads_tag, jsonb_array_length(nodes) as node_count;`;
const result = await runSql(update);
console.log('Target updated:', JSON.stringify(result));
