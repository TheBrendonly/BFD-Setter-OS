// Server-side proxy for GitHub API calls. Uses the GITHUB_PAT secret to get
// a 5000 req/hr rate limit and never exposes the token to the browser.
//
// SECURITY: requires an authenticated user — the proxy spends the server's
// GITHUB_PAT, so it must not be callable anonymously.
//
// Supported actions (sent in the JSON body):
//   { action: "repo",     owner, repo }                  -> repo metadata
//   { action: "tree",     owner, repo, branch?, recursive? } -> full file tree
//   { action: "contents", owner, repo, path, ref? }      -> file contents (decoded)
//   { action: "commits",  owner, repo, perPage? }        -> recent commits
//   { action: "languages", owner, repo }                 -> language breakdown
//   { action: "readme",   owner, repo }                  -> README markdown

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";

const GITHUB_API = "https://api.github.com";

interface ProxyBody {
  action: "repo" | "tree" | "contents" | "commits" | "languages" | "readme";
  owner: string;
  repo: string;
  branch?: string;
  recursive?: boolean;
  path?: string;
  ref?: string;
  perPage?: number;
}

function isValidSlug(s: unknown): s is string {
  return typeof s === "string" && /^[\w.-]{1,100}$/.test(s);
}

function isValidPath(s: unknown): s is string {
  // GitHub paths can have slashes, dots, dashes, underscores, spaces
  return typeof s === "string" && s.length <= 500 && !s.includes("..");
}

async function gh(url: string, token: string, accept = "application/vnd.github+json") {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bfd-setter-source-files-page",
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // SECURITY: require an authenticated user before spending the server PAT.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = Deno.env.get("GITHUB_PAT");
  if (!token) {
    return new Response(
      JSON.stringify({ error: "GITHUB_PAT is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: ProxyBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action, owner, repo } = body;
  if (!isValidSlug(owner) || !isValidSlug(repo)) {
    return new Response(JSON.stringify({ error: "Invalid owner/repo" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let url: string;
    let accept = "application/vnd.github+json";

    switch (action) {
      case "repo":
        url = `${GITHUB_API}/repos/${owner}/${repo}`;
        break;

      case "tree": {
        const branch = isValidSlug(body.branch) ? body.branch : "main";
        const recursive = body.recursive ? "?recursive=1" : "";
        url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}${recursive}`;
        break;
      }

      case "contents": {
        if (!isValidPath(body.path)) {
          return new Response(JSON.stringify({ error: "Invalid path" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const ref = isValidSlug(body.ref) ? `?ref=${body.ref}` : "";
        url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(body.path!).replace(/%2F/g, "/")}${ref}`;
        // request raw to easily decode
        accept = "application/vnd.github.raw";
        break;
      }

      case "commits": {
        const per = Math.min(Math.max(body.perPage ?? 10, 1), 30);
        url = `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=${per}`;
        break;
      }

      case "languages":
        url = `${GITHUB_API}/repos/${owner}/${repo}/languages`;
        break;

      case "readme":
        url = `${GITHUB_API}/repos/${owner}/${repo}/readme`;
        accept = "application/vnd.github.raw";
        break;

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // For raw responses (contents/readme), don't try to JSON.parse — return text.
    if (accept === "application/vnd.github.raw") {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "bfd-setter-source-files-page",
        },
      });
      const text = await res.text();
      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: `GitHub API ${res.status}`, detail: text.slice(0, 500) }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ content: text }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await gh(url, token, accept);
    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: `GitHub API ${result.status}`, detail: result.body }),
        { status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result.body), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Cache GitHub responses briefly to be polite to rate limits
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[github-proxy] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
