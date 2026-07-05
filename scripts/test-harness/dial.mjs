import { readFileSync } from "node:fs";
import crypto from "node:crypto";
const env=Object.fromEntries(readFileSync("/srv/bfd/Projects/bfd-setter/.env","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,"")];}));
const KEY=env.SUPABASE_SERVICE_ROLE_KEY;
const CID="e467dabc-57ee-416c-8831-83ecd9c7c925";
const SETTER=process.argv[2]||"b09624b5-5169-495a-bedd-fb6d3004ab34";
const phone=process.argv[3]||"+61405482446";
const withVoicemail=process.argv[4]==="vm";
const body={ client_id:CID, voice_setter_id:SETTER, contact_fields:{ phone, first_name:"Brendan", last_name:"Green", email:"brendanjamesgreen@gmail.com" }, idempotency_key:"test-"+crypto.randomBytes(6).toString("hex"), timezone:"Australia/Sydney" };
if(withVoicemail) body.voicemail_config={ mode:"prompt", text:"Leave a brief message saying you will try again later and why you called.", detect_enabled:true, detect_timeout_ms:15000 };
const r=await fetch(`${env.SUPABASE_URL}/functions/v1/make-retell-outbound-call`,{method:"POST",headers:{Authorization:"Bearer "+KEY,apikey:KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
const txt=await r.text();
console.log("dial HTTP", r.status);
try{const j=JSON.parse(txt); console.log(JSON.stringify({ok:j.ok,call_id:j.call_id||j.callId,status:j.status,error:j.error,agent:j.agent_id},null,0));}catch{console.log(txt.slice(0,300));}
