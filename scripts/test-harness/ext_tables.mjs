// Discover BFD's external Supabase tables. Reads creds into memory ONLY; prints table names only.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/srv/bfd/Projects/bfd-setter/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; })
);
const REF = "bjgrgbgykvjrsuwwruoh";
async function platformSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error("platform sql " + r.status + " " + await r.text());
  return r.json();
}
const rows = await platformSql("select supabase_url, supabase_service_key from clients where id='e467dabc-57ee-416c-8831-83ecd9c7c925'");
const { supabase_url, supabase_service_key } = rows[0];
// pull the OpenAPI spec -> lists tables/views exposed by PostgREST
const spec = await fetch(supabase_url.replace(/\/$/, "") + "/rest/v1/", {
  headers: { apikey: supabase_service_key, Authorization: "Bearer " + supabase_service_key },
});
if (!spec.ok) { console.error("rest spec", spec.status, (await spec.text()).slice(0, 200)); process.exit(1); }
const j = await spec.json();
const tables = Object.keys(j.definitions || j.paths || {}).filter(t => t && !t.startsWith("/"));
console.log("EXTERNAL TABLES/VIEWS (" + tables.length + "):");
console.log(tables.sort().join("\n"));
