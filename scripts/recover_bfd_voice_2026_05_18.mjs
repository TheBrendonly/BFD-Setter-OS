// Recovery script: restore BFD Retell LLM prompt + model + agent name + republish + repoint phone
// after the 2026-05-18 EE1 fan-out incident wiped the live LLM.
//
// Sequence:
//   1. Read Gary v3 prompt from frontend/src/data/bfdVoiceSetterPrompt.ts
//   2. PATCH LLM with new general_prompt + model=gemini-3.0-flash
//   3. PATCH agent with agent_name="Voice-Setter-1"
//   4. POST publish-agent to mint a new version
//   5. PATCH phone +61481614530 with inbound_agent_version + outbound_agent_version
//   6. Verify all live state
//
// Reads from /etc/bfd-secrets/bfd-os.env via source (run in bash wrapper).
// Run via: source /etc/bfd-secrets/bfd-os.env && node /tmp/recover_bfd_voice_2026_05_18.mjs

import { readFileSync } from 'fs';
import { request } from 'https';

const RETELL_KEY = process.env.BFD_RETELL_API_KEY || process.env.RETELL_API_KEY;
if (!RETELL_KEY) { console.error('Missing BFD_RETELL_API_KEY in env'); process.exit(1); }

const LLM_ID = 'llm_22e795de19b4d25cb579013586be';
const AGENT_ID = 'agent_5ec5eb129f3165cfa07b581a1a';
const PHONE = '+61481614530';
const TARGET_MODEL = 'gemini-3.0-flash';
const TARGET_AGENT_NAME = 'Voice-Setter-1';

const promptPath = '/srv/bfd/Projects/bfd-setter/frontend/src/data/bfdVoiceSetterPrompt.ts';
const content = readFileSync(promptPath, 'utf8');
const match = content.match(/BFD_VOICE_SETTER_PROMPT = `([\s\S]+?)`;/);
if (!match) { console.error('BFD_VOICE_SETTER_PROMPT not found'); process.exit(1); }
const prompt = match[1];
console.log('Loaded prompt:', prompt.length, 'chars');
console.log('First 100 chars:', prompt.substring(0, 100).replace(/\n/g, ' '));

const retell = (method, path, body) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const opts = {
    hostname: 'api.retellai.com',
    path,
    method,
    headers: {
      'Authorization': `Bearer ${RETELL_KEY}`,
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };
  const req = request(opts, res => {
    let data = '';
    res.on('data', d => { data += d; });
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
      catch { resolve({ status: res.statusCode, body: null, raw: data.substring(0, 500) }); }
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const stamp = (label) => console.log(`\n=== ${label} ===`);

(async () => {
  stamp('Step 0: pre-state');
  const llmBefore = await retell('GET', `/get-retell-llm/${LLM_ID}`);
  const agentBefore = await retell('GET', `/get-agent/${AGENT_ID}`);
  console.log('LLM model:', llmBefore.body?.model, 'prompt_len:', (llmBefore.body?.general_prompt || '').length, 'version:', llmBefore.body?.version);
  console.log('Agent name:', agentBefore.body?.agent_name, 'voice:', agentBefore.body?.voice_id, 'version:', agentBefore.body?.version);

  stamp('Step 1: PATCH LLM with Gary v3 prompt + model=gemini-3.0-flash');
  const llmPatch = await retell('PATCH', `/update-retell-llm/${LLM_ID}`, {
    general_prompt: prompt,
    model: TARGET_MODEL,
  });
  console.log('PATCH llm HTTP:', llmPatch.status);
  console.log('New prompt length:', (llmPatch.body?.general_prompt || '').length, 'model:', llmPatch.body?.model);
  if (llmPatch.status !== 200 && llmPatch.status !== 201) {
    console.error('LLM PATCH FAILED:', JSON.stringify(llmPatch.body || llmPatch.raw).substring(0, 800));
    process.exit(1);
  }

  stamp('Step 2: PATCH agent name → Voice-Setter-1');
  const agentPatch = await retell('PATCH', `/update-agent/${AGENT_ID}`, {
    agent_name: TARGET_AGENT_NAME,
  });
  console.log('PATCH agent HTTP:', agentPatch.status);
  console.log('New agent_name:', agentPatch.body?.agent_name);
  if (agentPatch.status !== 200 && agentPatch.status !== 201) {
    console.error('AGENT PATCH FAILED:', JSON.stringify(agentPatch.body || agentPatch.raw).substring(0, 800));
    process.exit(1);
  }

  stamp('Step 3: POST publish-agent');
  const pubResp = await retell('POST', `/publish-agent/${AGENT_ID}`, {});
  console.log('PUBLISH HTTP:', pubResp.status);
  const newVersion = pubResp.body?.version;
  console.log('New published version:', newVersion);
  if (pubResp.status !== 200 && pubResp.status !== 201) {
    console.error('PUBLISH FAILED:', JSON.stringify(pubResp.body || pubResp.raw).substring(0, 800));
    process.exit(1);
  }

  stamp(`Step 4: PATCH phone ${PHONE} with inbound + outbound versions = ${newVersion}`);
  const phonePatch = await retell('PATCH', `/update-phone-number/${encodeURIComponent(PHONE)}`, {
    inbound_agent_version: newVersion,
    outbound_agent_version: newVersion,
  });
  console.log('PATCH phone HTTP:', phonePatch.status);
  console.log('inbound_agent_version:', phonePatch.body?.inbound_agent_version, 'outbound_agent_version:', phonePatch.body?.outbound_agent_version);
  if (phonePatch.status !== 200 && phonePatch.status !== 201) {
    console.error('PHONE PATCH FAILED:', JSON.stringify(phonePatch.body || phonePatch.raw).substring(0, 800));
    process.exit(1);
  }

  stamp('Step 5: Verify final state');
  const llmAfter = await retell('GET', `/get-retell-llm/${LLM_ID}`);
  const agentAfter = await retell('GET', `/get-agent/${AGENT_ID}`);
  const phoneAfter = await retell('GET', `/get-phone-number/${encodeURIComponent(PHONE)}`);
  console.log('LLM model:', llmAfter.body?.model, 'prompt_len:', (llmAfter.body?.general_prompt || '').length, 'version:', llmAfter.body?.version);
  console.log('Agent name:', agentAfter.body?.agent_name, 'voice:', agentAfter.body?.voice_id, 'version:', agentAfter.body?.version, 'published:', agentAfter.body?.is_published);
  console.log('Phone inbound_agent_version:', phoneAfter.body?.inbound_agent_version, 'outbound_agent_version:', phoneAfter.body?.outbound_agent_version);

  const allGood =
    (llmAfter.body?.general_prompt || '').length > 11000 &&
    llmAfter.body?.model === TARGET_MODEL &&
    agentAfter.body?.agent_name === TARGET_AGENT_NAME &&
    phoneAfter.body?.inbound_agent_version === newVersion &&
    phoneAfter.body?.outbound_agent_version === newVersion;

  console.log('\n' + (allGood ? '✅ RECOVERY VERIFIED' : '⚠️  Some checks failed — review above'));
  process.exit(allGood ? 0 : 1);
})();
