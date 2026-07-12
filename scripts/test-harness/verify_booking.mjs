// Verify the newest confirmed booking landed in GHL (does the appointment exist + its status).
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/srv/bfd/Projects/bfd-setter/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; })
);
const REF = "bjgrgbgykvjrsuwwruoh";
const CID = "e467dabc-57ee-416c-8831-83ecd9c7c925";
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) throw new Error("sql " + r.status + " " + await r.text());
  return r.json();
}
const [c] = await sql(`select ghl_api_key from clients where id='${CID}'`);
const rows = await sql(`select left(id::text,8) as id, source, status, appointment_time, ghl_appointment_id, created_at from bookings where client_id='${CID}' and created_at > now() - interval '15 minutes' order by created_at desc limit 5`);
console.log("recent bookings (15 min):");
for (const b of rows) console.log("  ", b.id, b.source, b.status, b.appointment_time, "ghl=" + b.ghl_appointment_id);
const target = rows.find(b => b.status === "confirmed");
if (!target) { console.log("NO confirmed booking in the window."); process.exit(0); }
const r = await fetch(`https://services.leadconnectorhq.com/calendars/events/appointments/${target.ghl_appointment_id}`, {
  headers: { Authorization: `Bearer ${c.ghl_api_key}`, Version: "2021-04-15" },
});
const j = await r.json();
const a = j.appointment || j.event || j;
console.log("\nGHL appointment GET", r.status);
console.log("  status:", a.appointmentStatus || a.status, "| startTime:", a.startTime, "| title:", a.title);
console.log("  calendarId:", a.calendarId, "| contactId:", a.contactId, "| assignedUserId:", a.assignedUserId);
console.log("  notifications/raw keys:", Object.keys(a));
