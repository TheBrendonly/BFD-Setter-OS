// Clone the base Try-Gary cadence into one campaign per persona (tag-per-campaign
// agent routing, decided 2026-06-01). Content is cloned verbatim from the base
// Try-Gary cadence (3fda0794); each persona's phone_call nodes get a clear
// TODO sentinel voice_setter_id so Brendan sets the right voice agent. Each
// persona campaign is INACTIVE and tagged bfd_setter-try_gary-<persona>.
// Idempotent: skips a persona whose tag already exists.
//
//   SUPABASE_PAT=… node scripts/clone_try_gary_personas.mjs
const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Missing SUPABASE_PAT'); process.exit(1); }
const REF = 'bjgrgbgykvjrsuwwruoh';
const CLIENT = 'e467dabc-57ee-416c-8831-83ecd9c7c925'; // BFD
const BASE_WF = '3fda0794-006e-4285-8e4c-04b9667327c9'; // base Try-Gary cadence
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Generic Demo stays as the base campaign (tag bfd_setter-try_gary). These are
// the differentiated personas that each get their own campaign + agent.
const PERSONAS = [
  { key: 'property_coach', name: 'Property Coach' },
  { key: 'mortgage_broker', name: 'Mortgage Broker' },
  { key: 'finance_strategist', name: 'Finance Strategist' },
  { key: 'crazy_gary', name: 'Crazy Gary' },
];

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

// Base nodes + current max sort_order.
const [{ nodes: baseNodes }] = await runSql(`select nodes from engagement_workflows where id = '${BASE_WF}';`);
const [{ max_sort }] = await runSql(`select coalesce(max(sort_order),0) as max_sort from engagement_workflows where client_id = '${CLIENT}';`);
let sort = Number(max_sort);

for (const p of PERSONAS) {
  const tag = `bfd_setter-try_gary-${p.key}`;
  const name = `Try-Gary: ${p.name}`;
  const existing = await runSql(`select id from engagement_workflows where client_id='${CLIENT}' and new_leads_tag='${tag}';`);
  if (existing.length) { console.log(`SKIP ${name} (tag ${tag} already exists: ${existing[0].id})`); continue; }

  // Clone nodes, set phone_call voice_setter_id to a persona-specific TODO sentinel.
  const sentinel = `TODO-confirm-${p.key}-agent`;
  const nodes = (baseNodes || []).map((node) => {
    if (Array.isArray(node.channels)) {
      node.channels = node.channels.map((ch) =>
        ch.type === 'phone_call' && 'voice_setter_id' in ch ? { ...ch, voice_setter_id: sentinel } : ch);
    }
    return node;
  });
  sort += 1;
  const nodesLit = JSON.stringify(nodes);

  const [wf] = await runSql(`insert into engagement_workflows
    (client_id, name, nodes, is_active, is_new_leads_campaign, new_leads_tag, sort_order)
    values ('${CLIENT}', $name$${name}$name$, $cad$${nodesLit}$cad$::jsonb, false, true, '${tag}', ${sort})
    returning id;`);
  const [camp] = await runSql(`insert into engagement_campaigns (client_id, workflow_id, name)
    values ('${CLIENT}', '${wf.id}', $name$${name}$name$) returning id, text_setter_number;`);
  console.log(`CREATED ${name} -> wf ${wf.id}, campaign ${camp.id}, tag ${tag}, voice sentinel ${sentinel}, text_setter ${camp.text_setter_number} (default), INACTIVE`);
}

console.log('\nDone. Generic Demo remains the base campaign (tag bfd_setter-try_gary).');
