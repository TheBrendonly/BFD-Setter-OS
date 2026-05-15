// Deploy BFD voice setter prompt to Retell LLM, then publish the agent.
// Reads BFD_VOICE_SETTER_PROMPT from frontend/src/data/bfdVoiceSetterPrompt.ts.
// Run with: node --env-file=.env scripts/deploy_voice_prompt.mjs
//
// Env vars (from .env):
//   BFD_RETELL_API_KEY       Retell account API key (required)
//   BFD_RETELL_LLM_ID        LLM to patch (default: llm_22e795de19b4d25cb579013586be)
//   BFD_RETELL_AGENT_ID      Agent to publish (default: agent_5ec5eb129f3165cfa07b581a1a)
//
// A PATCH on the LLM does NOT propagate to the running agent until the agent is
// republished, so this script does both, in order: GET current LLM (to preserve
// model), PATCH new general_prompt, POST publish-agent.

import { readFileSync } from 'fs';
import { request } from 'https';

const RETELL_KEY = process.env.BFD_RETELL_API_KEY;
if (!RETELL_KEY) { console.error('Missing BFD_RETELL_API_KEY in .env'); process.exit(1); }
const LLM_ID = process.env.BFD_RETELL_LLM_ID || 'llm_22e795de19b4d25cb579013586be';
const AGENT_ID = process.env.BFD_RETELL_AGENT_ID || 'agent_5ec5eb129f3165cfa07b581a1a';

const promptFileUrl = new URL('../frontend/src/data/bfdVoiceSetterPrompt.ts', import.meta.url);
const content = readFileSync(promptFileUrl, 'utf8');
const match = content.match(/BFD_VOICE_SETTER_PROMPT = `([\s\S]+?)`;/);
if (!match) { console.error('BFD_VOICE_SETTER_PROMPT template not found in', promptFileUrl.pathname); process.exit(1); }
const prompt = match[1];
console.log('Prompt length:', prompt.length);
console.log('Starts with:', prompt.substring(0, 80));

const retellRequest = (method, path, body) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const opts = {
    hostname: 'api.retellai.com',
    path,
    method,
    headers: {
      'Authorization': `Bearer ${RETELL_KEY}`,
      ...(payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {}),
    },
  };
  const req = request(opts, res => {
    let data = '';
    res.on('data', d => { data += d; });
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
      catch (e) { resolve({ status: res.statusCode, body: null, raw: data.substring(0, 300) }); }
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

(async () => {
  console.log('\n[1/3] Fetching current LLM config (to preserve model)...');
  const getResp = await retellRequest('GET', `/get-retell-llm/${LLM_ID}`);
  console.log('GET HTTP:', getResp.status);
  console.log('Current model:', getResp.body?.model);
  console.log('Current prompt length:', (getResp.body?.general_prompt || '').length);

  console.log('\n[2/3] Patching LLM with new prompt...');
  const patchResp = await retellRequest('PATCH', `/update-retell-llm/${LLM_ID}`, {
    general_prompt: prompt,
    model: getResp.body?.model || 'gemini-3.0-flash',
  });
  console.log('PATCH HTTP:', patchResp.status);
  console.log('New general_prompt length:', (patchResp.body?.general_prompt || '').length);
  console.log('Starts with:', (patchResp.body?.general_prompt || '').substring(0, 80));
  if (patchResp.body?.error) console.log('PATCH error:', patchResp.body.error);

  console.log('\n[3/3] Publishing agent', AGENT_ID, '...');
  const pubResp = await retellRequest('POST', `/publish-agent/${AGENT_ID}`, {});
  console.log('PUBLISH HTTP:', pubResp.status);
  if (pubResp.body?.error) console.log('PUBLISH error:', pubResp.body.error);
  if (pubResp.body?.version) console.log('New published version:', pubResp.body.version);

  const ok = patchResp.status === 200 || patchResp.status === 201;
  const pubOk = pubResp.status === 200 || pubResp.status === 201;
  if (!ok || !pubOk) {
    console.error('\nDEPLOY FAILED. Investigate before retrying.');
    process.exit(1);
  }
  console.log('\nDONE.');
})();
