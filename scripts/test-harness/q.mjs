// Mgmt API SQL runner against the PLATFORM db. Usage: node q.mjs "SELECT ..."
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/srv/bfd/Projects/bfd-setter/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; })
);
const REF = "bjgrgbgykvjrsuwwruoh";
const PAT = env.SUPABASE_PAT;
const sql = process.argv[2];
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${PAT}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) { console.error("HTTP", res.status, text); process.exit(1); }
console.log(text);
