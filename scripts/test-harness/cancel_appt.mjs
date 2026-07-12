// Cancel this session's SMS test appointments (source='sms', confirmed, created in the last N min) and
// mirror the bookings row. Reads ghl_api_key in-memory (never printed). Leaves the real 14 Jul voice appt alone.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/srv/bfd/Projects/bfd-setter/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; })
);
const REF = "bjgrgbgykvjrsuwwruoh";
const CID = "e467dabc-57ee-416c-8831-83ecd9c7c925";
const MIN = Number(process.argv[2] || 25);
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) throw new Error("sql " + r.status + " " + await r.text());
  return r.json();
}
const [c] = await sql(`select ghl_api_key from clients where id='${CID}'`);
const KEY = c.ghl_api_key;
const rows = await sql(`select id, source, ghl_appointment_id, appointment_time from bookings where client_id='${CID}' and status='confirmed' and created_at > now() - interval '${MIN} minutes'`);
console.log("targets to cancel:", rows.map(r => ({ id: r.id.slice(0, 8), appt: r.appointment_time, ghl: r.ghl_appointment_id })));
for (const b of rows) {
  const res = await fetch(`https://services.leadconnectorhq.com/calendars/events/appointments/${b.ghl_appointment_id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${KEY}`, Version: "2021-04-15", "Content-Type": "application/json" },
    body: JSON.stringify({ appointmentStatus: "cancelled" }),
  });
  const txt = (await res.text()).slice(0, 120);
  await sql(`update bookings set status='cancelled' where id='${b.id}'`);
  console.log("cancelled", b.ghl_appointment_id, "GHL", res.status, "| booking row -> cancelled |", txt.replace(/\n/g, " "));
}
console.log("done; cancelled", rows.length, "test appointment(s).");
