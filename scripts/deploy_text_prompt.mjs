// One-shot: deploy BFD text setter prompt to bfd-setter-live text_prompts.Setter-1
// Source secrets from .env. Run with: node --env-file=.env scripts/deploy_text_prompt.mjs
import { readFileSync } from 'fs';
import { request } from 'https';

const KEY = process.env.BFD_SETTER_LIVE_SECRET_KEY;
if (!KEY) { console.error('Missing BFD_SETTER_LIVE_SECRET_KEY in .env'); process.exit(1); }
const ROW_ID = 'e8df4178-c5f9-4366-a924-134ae6b9733c';

const content = readFileSync('c:/Projects/Projects/1prompt-os/frontend/src/data/bfdTextSetterPrompt.ts', 'utf8');
const match = content.match(/BFD_TEXT_SETTER_PROMPT = `([\s\S]+)`;/);
if (!match) { console.error('PROMPT NOT FOUND'); process.exit(1); }
const prompt = match[1];
console.log('Prompt length:', prompt.length);

const body = JSON.stringify({ system_prompt: prompt });

const opts = {
  hostname: 'qildpilxjodxdifggmto.supabase.co',
  path: `/rest/v1/text_prompts?id=eq.${ROW_ID}`,
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
      console.log('system_prompt length:', (row?.system_prompt || '').length);
      console.log('starts with:', (row?.system_prompt || '').substring(0, 80));
      if (row?.message) console.log('error:', row.message);
    } catch (e) {
      console.log('parse error, raw:', data.substring(0, 300));
    }
  });
});
req.on('error', e => console.error('request error:', e.message));
req.write(body);
req.end();
