// One-shot: deploy BFD voice setter prompt to Retell LLM llm_22e795de19b4d25cb579013586be
// Source secrets from .env. Run with: node --env-file=.env scripts/deploy_voice_prompt.mjs
import { readFileSync } from 'fs';
import { request } from 'https';

const RETELL_KEY = process.env.BFD_RETELL_API_KEY;
if (!RETELL_KEY) { console.error('Missing BFD_RETELL_API_KEY in .env'); process.exit(1); }
const LLM_ID = process.env.BFD_RETELL_LLM_ID || 'llm_22e795de19b4d25cb579013586be';

const content = readFileSync('c:/Projects/Projects/1prompt-os/frontend/src/data/bfdVoiceSetterPrompt.ts', 'utf8');
const match = content.match(/BFD_VOICE_SETTER_PROMPT = `([\s\S]+)`;/);
if (!match) { console.error('PROMPT NOT FOUND'); process.exit(1); }
const prompt = match[1];
console.log('Prompt length:', prompt.length);
console.log('Starts with:', prompt.substring(0, 80));

// First, GET the current LLM to preserve model and other settings
const getOpts = {
  hostname: 'api.retellai.com',
  path: `/get-retell-llm/${LLM_ID}`,
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${RETELL_KEY}`,
  },
};

const getLlm = () => new Promise((resolve, reject) => {
  const req = request(getOpts, res => {
    let data = '';
    res.on('data', d => { data += d; });
    res.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.end();
});

const patchLlm = (currentModel) => new Promise((resolve, reject) => {
  const body = JSON.stringify({
    general_prompt: prompt,
    model: currentModel || 'gpt-4o',
  });

  const patchOpts = {
    hostname: 'api.retellai.com',
    path: `/update-retell-llm/${LLM_ID}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${RETELL_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = request(patchOpts, res => {
    let data = '';
    res.on('data', d => { data += d; });
    res.on('end', () => {
      try {
        const r = JSON.parse(data);
        console.log('HTTP:', res.statusCode);
        console.log('general_prompt length:', (r?.general_prompt || '').length);
        console.log('starts with:', (r?.general_prompt || '').substring(0, 80));
        console.log('model:', r?.model);
        if (r?.error) console.log('error:', r.error);
        resolve(r);
      } catch (e) {
        console.log('parse error, raw:', data.substring(0, 300));
        resolve(null);
      }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

(async () => {
  console.log('Fetching current LLM config...');
  const current = await getLlm();
  console.log('Current model:', current?.model);
  console.log('Current prompt length:', (current?.general_prompt || '').length);

  console.log('\nPatching prompt...');
  await patchLlm(current?.model);
})();
