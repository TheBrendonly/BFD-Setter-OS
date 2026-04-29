// Update voice_prompts.Setter-1 on bfd-setter-live with the BFD Aria v2 voice prompt
// Source secrets from .env. Run with: node --env-file=.env scripts/update_voice_prompts_setter1.mjs
import { readFileSync } from 'fs';
import { request } from 'https';

const KEY = process.env.BFD_SETTER_LIVE_SERVICE_ROLE;
if (!KEY) { console.error('Missing BFD_SETTER_LIVE_SERVICE_ROLE in .env'); process.exit(1); }

const content = readFileSync('c:/Projects/Projects/1prompt-os/frontend/src/data/bfdVoiceSetterPrompt.ts', 'utf8');
const match = content.match(/BFD_VOICE_SETTER_PROMPT = `([\s\S]+)`;/);
if (!match) { console.error('PROMPT NOT FOUND'); process.exit(1); }
const prompt = match[1];
console.log('Prompt length:', prompt.length);

const body = JSON.stringify({ system_prompt: prompt, model: 'gpt-5', booking_function_enabled: true });

const opts = {
  hostname: 'qildpilxjodxdifggmto.supabase.co',
  path: '/rest/v1/voice_prompts?card_name=eq.Setter-1',
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${KEY}`,
    'apikey': KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = request(opts, res => {
  let data = '';
  res.on('data', d => { data += d; });
  res.on('end', () => {
    try {
      const r = JSON.parse(data);
      const row = Array.isArray(r) ? r[0] : r;
      console.log('HTTP:', res.statusCode);
      console.log('card_name:', row?.card_name);
      console.log('system_prompt length:', (row?.system_prompt || '').length);
      console.log('model:', row?.model);
      if (row?.message) console.log('error:', row.message);
    } catch (e) {
      console.log('parse error, raw:', data.substring(0, 200));
    }
  });
});
req.on('error', e => console.error('error:', e.message));
req.write(body);
req.end();
