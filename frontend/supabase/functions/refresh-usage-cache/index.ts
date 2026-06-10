import { createClient } from 'npm:@supabase/supabase-js@2'
import { grantsServiceRole } from '../_shared/authorize-client-request.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MGMT_API = 'https://api.supabase.com/v1'

function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function mgmtFetch<T = any>(path: string, token: string) {
  const res = await fetch(`${MGMT_API}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) {
    await res.text()
    return { data: null, error: `${res.status}` }
  }
  return { data: await res.json() as T, error: null }
}

async function mgmtPost<T = any>(path: string, token: string, body: unknown) {
  const res = await fetch(`${MGMT_API}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await res.text()
    return { data: null, error: `${res.status}` }
  }
  return { data: await res.json() as T, error: null }
}

// --- OpenRouter refresh ---
async function refreshOpenRouter(supabase: any, client: any) {
  const apiKey = client.openrouter_api_key
  if (!apiKey) return

  const mgmtKey = client.openrouter_management_key

  const [creditsRes, keyRes, activityRes] = await Promise.all([
    fetch('https://openrouter.ai/api/v1/credits', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }),
    fetch('https://openrouter.ai/api/v1/key', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }),
    fetch('https://openrouter.ai/api/v1/activity', {
      headers: { 'Authorization': `Bearer ${mgmtKey || apiKey}` },
    }),
  ])

  let credits = null
  if (creditsRes.ok) {
    const json = await creditsRes.json()
    const d = json.data
    credits = {
      total_credits: d?.total_credits ?? 0,
      total_usage: d?.total_usage ?? 0,
      remaining: (d?.total_credits ?? 0) - (d?.total_usage ?? 0),
    }
  } else {
    await creditsRes.text()
  }

  let keyUsage = null
  if (keyRes.ok) {
    const json = await keyRes.json()
    const d = json.data
    keyUsage = {
      label: d?.label ?? '',
      usage: d?.usage ?? 0,
      usage_daily: d?.usage_daily ?? 0,
      usage_weekly: d?.usage_weekly ?? 0,
      usage_monthly: d?.usage_monthly ?? 0,
      limit: d?.limit ?? null,
      limit_remaining: d?.limit_remaining ?? null,
      is_free_tier: d?.is_free_tier ?? false,
    }
  } else {
    await keyRes.text()
  }

  let activity: any[] = []
  if (activityRes.ok) {
    const json = await activityRes.json()
    activity = json.data || []
  } else {
    await activityRes.text()
  }

  const now = new Date().toISOString()
  const cachePayload = { credits, keyUsage, activity }

  await supabase
    .from('openrouter_usage_cache')
    .upsert({
      client_id: client.id,
      cached_data: cachePayload,
      last_refreshed: now,
    }, { onConflict: 'client_id' })

  console.log(`[OpenRouter] Refreshed cache for client ${client.id}`)
}

// --- Supabase Usage refresh ---
async function refreshSupabaseUsage(supabase: any, client: any) {
  const pat = client.supabase_access_token
  const url = client.supabase_url
  if (!pat || !url) return

  const urlMatch = url.match(/https:\/\/([^.]+)\.supabase\.co/)
  if (!urlMatch) return

  const projectRef = urlMatch[1]

  const healthQuery = new URLSearchParams()
  ;['postgres', 'auth', 'rest', 'realtime', 'storage', 'functions'].forEach((s) => {
    healthQuery.append('services', s)
  })

  const [projectRes, addonsRes, subscriptionRes, apiCountsRes, apiRequestsRes, diskUtilRes, healthRes] =
    await Promise.all([
      mgmtFetch(`/projects/${projectRef}`, pat),
      mgmtFetch(`/projects/${projectRef}/billing/addons`, pat),
      mgmtFetch(`/projects/${projectRef}/subscription`, pat),
      mgmtFetch(`/projects/${projectRef}/analytics/endpoints/usage.api-counts?interval=1day`, pat),
      mgmtFetch(`/projects/${projectRef}/analytics/endpoints/usage.api-requests-count?interval=1day`, pat),
      mgmtFetch(`/projects/${projectRef}/config/disk/util`, pat),
      mgmtFetch(`/projects/${projectRef}/health?${healthQuery.toString()}`, pat),
    ])

  const schemaRes = await mgmtPost(`/projects/${projectRef}/database/query`, pat, {
    query: `
      SELECT t.table_name, t.table_type,
        pg_total_relation_size(quote_ident(t.table_schema)||'.'||quote_ident(t.table_name)) as total_bytes,
        pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema)||'.'||quote_ident(t.table_name))) as total_size,
        (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema=t.table_schema AND c.table_name=t.table_name) as column_count,
        s.n_live_tup as estimated_rows, s.last_autoanalyze, s.last_autovacuum
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname=t.table_name AND s.schemaname=t.table_schema
      WHERE t.table_schema='public'
      ORDER BY pg_total_relation_size(quote_ident(t.table_schema)||'.'||quote_ident(t.table_name)) DESC
    `,
  })

  const columnsRes = await mgmtPost(`/projects/${projectRef}/database/query`, pat, {
    query: `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
  })

  const rlsRes = await mgmtPost(`/projects/${projectRef}/database/query`, pat, {
    query: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'`,
  })

  const apiCountsResult = Array.isArray((apiCountsRes.data as any)?.result)
    ? (apiCountsRes.data as any).result
    : Array.isArray(apiCountsRes.data) ? apiCountsRes.data : []

  const usageSummary = apiCountsResult.length > 0
    ? apiCountsResult.reduce((acc: any, item: any) => {
        acc.total_auth_requests += toNum(item.total_auth_requests)
        acc.total_rest_requests += toNum(item.total_rest_requests)
        acc.total_realtime_requests += toNum(item.total_realtime_requests)
        acc.total_storage_requests += toNum(item.total_storage_requests)
        return acc
      }, { total_auth_requests: 0, total_rest_requests: 0, total_realtime_requests: 0, total_storage_requests: 0 })
    : null

  if (usageSummary) {
    usageSummary.total_requests =
      usageSummary.total_auth_requests + usageSummary.total_rest_requests +
      usageSummary.total_realtime_requests + usageSummary.total_storage_requests
  }

  const apiRequestsResult = Array.isArray((apiRequestsRes.data as any)?.result)
    ? (apiRequestsRes.data as any).result : []
  const apiRequestsTotal = apiRequestsResult.reduce((sum: number, item: any) => {
    return sum + toNum(item?.count ?? item?.total_requests ?? item?.requests)
  }, 0)

  const result: Record<string, any> = {
    project: projectRes.data ? {
      id: (projectRes.data as any).id, name: (projectRes.data as any).name,
      region: (projectRes.data as any).region, status: (projectRes.data as any).status,
      created_at: (projectRes.data as any).created_at,
      organization_id: (projectRes.data as any).organization_id,
      database: (projectRes.data as any).database,
    } : null,
    project_error: projectRes.error || null,
    addons: { selected_addons: (addonsRes.data as any)?.selected_addons || [] },
    addons_error: addonsRes.error || null,
    subscription: subscriptionRes.data || null,
    subscription_error: subscriptionRes.error || null,
    api_counts: apiCountsRes.data || null,
    api_counts_error: apiCountsRes.error || null,
    api_usage_summary: usageSummary,
    api_requests: apiRequestsRes.data || null,
    api_requests_error: apiRequestsRes.error || null,
    api_requests_total: apiRequestsTotal,
    disk_util: diskUtilRes.data || null,
    disk_util_error: diskUtilRes.error || null,
    health: healthRes.data || null,
    health_error: healthRes.error || null,
    tables: schemaRes.data || null,
    tables_error: schemaRes.error || null,
    columns: columnsRes.data || null,
    columns_error: columnsRes.error || null,
    rls_status: rlsRes.data || null,
  }

  const now = new Date().toISOString()
  await supabase
    .from('supabase_usage_cache')
    .upsert({
      client_id: client.id,
      cached_data: result,
      last_refreshed: now,
    }, { onConflict: 'client_id' })

  console.log(`[Supabase] Refreshed cache for client ${client.id}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Service-role / cron only: this reads EVERY client's provider keys and
    // calls external billing APIs, so it must never be reachable with the anon
    // key or a user JWT. The cron invoker presents the service role.
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!bearer || !(await grantsServiceRole(bearer))) {
      return new Response(JSON.stringify({ error: 'Forbidden — service role required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use service role to access all clients
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get all clients that have either OpenRouter or Supabase keys
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, openrouter_api_key, openrouter_management_key, supabase_url, supabase_access_token')

    if (error) throw error
    if (!clients || clients.length === 0) {
      return new Response(JSON.stringify({ message: 'No clients to refresh' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: string[] = []

    for (const client of clients) {
      try {
        if (client.openrouter_api_key) {
          await refreshOpenRouter(supabase, client)
          results.push(`OpenRouter OK: ${client.id}`)
        }
      } catch (e) {
        console.error(`OpenRouter error for ${client.id}:`, e)
        results.push(`OpenRouter FAIL: ${client.id}`)
      }

      try {
        if (client.supabase_access_token && client.supabase_url) {
          await refreshSupabaseUsage(supabase, client)
          results.push(`Supabase OK: ${client.id}`)
        }
      } catch (e) {
        console.error(`Supabase error for ${client.id}:`, e)
        results.push(`Supabase FAIL: ${client.id}`)
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('refresh-usage-cache error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
