// Simulate a Twilio inbound SMS to receive-twilio-sms with a valid signature.
// Creds read in-memory from DB; auth token never printed. Usage: node sms_inbound.mjs "Body text"
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
const env = Object.fromEntries(
  readFileSync("/srv/bfd/Projects/bfd-setter/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; })
);
const REF = "bjgrgbgykvjrsuwwruoh";
const SUPABASE_URL = env.SUPABASE_URL;
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) throw new Error("sql " + r.status + " " + await r.text());
  return r.json();
}
const [c] = await sql("select twilio_auth_token, twilio_account_sid, retell_phone_1 from clients where id='e467dabc-57ee-416c-8831-83ecd9c7c925'");
const AUTH = c.twilio_auth_token, SID = c.twilio_account_sid, TO = c.retell_phone_1;
const FROM = "+61405482446"; // TEST_PHONE_A (free-use)
const body = process.argv[2] || "Hi, can I book a meeting please?";
const rand = crypto.randomBytes(16).toString("hex");
const params = { AccountSid: SID, Body: body, From: FROM, MessageSid: "SM" + rand, NumMedia: "0", NumSegments: "1", To: TO };
const publicUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/receive-twilio-sms`;
// signature: HMAC-SHA1(publicUrl + sorted(k+v)) base64
let data = publicUrl;
for (const k of Object.keys(params).sort()) data += k + params[k];
const sig = crypto.createHmac("sha1", AUTH).update(data, "utf8").digest("base64");
const formBody = new URLSearchParams(params).toString();
const res = await fetch(publicUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
  body: formBody,
});
console.log("POST", publicUrl.replace(SUPABASE_URL, "<supabase>"));
console.log("From", FROM, "-> To", TO, "| Body:", JSON.stringify(body));
console.log("MessageSid", params.MessageSid);
console.log("HTTP", res.status, "|", (await res.text()).slice(0, 160).replace(/\n/g, " "));
