// PostgREST helper against the platform Supabase using the service key.
// Usage: node rest.mjs "clients?id=eq.<uuid>&select=id,name"
//        node rest.mjs "<path>" POST '{"json":"body"}'
import fs from "node:fs";

const envText = fs.readFileSync("/srv/bfd/Projects/bfd-setter/.env", "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }),
);

const [path, method = "GET", body] = process.argv.slice(2);

const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
  method,
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  ...(body ? { body } : {}),
});

const text = await response.text();
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${text}`);
  process.exit(1);
}
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
