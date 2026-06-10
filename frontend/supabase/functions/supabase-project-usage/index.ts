import { createClient } from 'npm:@supabase/supabase-js@2.101.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MGMT_API = 'https://api.supabase.com/v1'

type MgmtResult<T = any> = {
  data?: T
  error?: string
  status: number
}

async function mgmtFetch<T = any>(path: string, token: string): Promise<MgmtResult<T>> {
  const res = await fetch(`${MGMT_API}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Management API error [${res.status}] ${path}: ${text}`)
    return { error: `${res.status}: ${text}`, status: res.status }
  }

  return { data: await res.json(), status: res.status }
}

async function mgmtPost<T = any>(path: string, token: string, body: unknown): Promise<MgmtResult<T>> {
  const res = await fetch(`${MGMT_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Management API POST error [${res.status}] ${path}: ${text}`)
    return { error: `${res.status}: ${text}`, status: res.status }
  }

  return { data: await res.json(), status: res.status }
}

function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { client_id, action, table_name } = await req.json()
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('supabase_url, supabase_access_token')
      .eq('id', client_id)
      .single()

    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!client.supabase_access_token) {
      return new Response(
        JSON.stringify({ error: 'no_pat', message: 'Supabase Personal Access Token not configured' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!client.supabase_url) {
      return new Response(
        JSON.stringify({ error: 'no_url', message: 'Supabase URL not configured' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const urlMatch = client.supabase_url.match(/https:\/\/([^.]+)\.supabase\.co/)
    if (!urlMatch) {
      return new Response(
        JSON.stringify({ error: 'invalid_url', message: 'Invalid Supabase URL format' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const projectRef = urlMatch[1]
    const pat = client.supabase_access_token

    if (action === 'table_data' && table_name) {
      const safeName = table_name.replace(/[^a-zA-Z0-9_]/g, '')
      const queryRes = await mgmtPost(`/projects/${projectRef}/database/query`, pat, {
        query: `SELECT * FROM public."${safeName}" ORDER BY ctid DESC LIMIT 50`,
      })

      const rows = Array.isArray(queryRes.data)
        ? queryRes.data
        : Array.isArray((queryRes.data as any)?.result)
          ? (queryRes.data as any).result
          : []

      return new Response(
        JSON.stringify({
          table_name: safeName,
          rows,
          error: queryRes.error || null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const healthQuery = new URLSearchParams()
    ;['postgres', 'auth', 'rest', 'realtime', 'storage', 'functions'].forEach((service) => {
      healthQuery.append('services', service)
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
        SELECT 
          t.table_name,
          t.table_type,
          pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) as total_bytes,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as total_size,
          (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) as column_count,
          s.n_live_tup as estimated_rows,
          s.last_autoanalyze,
          s.last_autovacuum
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema
        WHERE t.table_schema = 'public'
        ORDER BY pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) DESC
      `,
    })

    const columnsRes = await mgmtPost(`/projects/${projectRef}/database/query`, pat, {
      query: `
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `,
    })

    const rlsRes = await mgmtPost(`/projects/${projectRef}/database/query`, pat, {
      query: `
        SELECT tablename, rowsecurity 
        FROM pg_tables 
        WHERE schemaname = 'public'
      `,
    })

    const apiCountsResult = Array.isArray((apiCountsRes.data as any)?.result)
      ? (apiCountsRes.data as any).result
      : Array.isArray(apiCountsRes.data) ? apiCountsRes.data : []

    // Sum ALL intervals for accurate 24h totals
    const usageSummary = apiCountsResult.length > 0
      ? apiCountsResult.reduce((acc: any, item: any) => {
          acc.total_auth_requests += toNum(item.total_auth_requests);
          acc.total_rest_requests += toNum(item.total_rest_requests);
          acc.total_realtime_requests += toNum(item.total_realtime_requests);
          acc.total_storage_requests += toNum(item.total_storage_requests);
          return acc;
        }, {
          total_auth_requests: 0,
          total_rest_requests: 0,
          total_realtime_requests: 0,
          total_storage_requests: 0,
        })
      : null;

    if (usageSummary) {
      usageSummary.total_requests =
        usageSummary.total_auth_requests +
        usageSummary.total_rest_requests +
        usageSummary.total_realtime_requests +
        usageSummary.total_storage_requests;
    }

    const apiRequestsResult = Array.isArray((apiRequestsRes.data as any)?.result)
      ? (apiRequestsRes.data as any).result
      : []

    const apiRequestsTotal = apiRequestsResult.reduce((sum: number, item: any) => {
      return sum + toNum(item?.count ?? item?.total_requests ?? item?.requests)
    }, 0)

    const result: Record<string, any> = {
      project: projectRes.data
        ? {
            id: (projectRes.data as any).id,
            name: (projectRes.data as any).name,
            region: (projectRes.data as any).region,
            status: (projectRes.data as any).status,
            created_at: (projectRes.data as any).created_at,
            organization_id: (projectRes.data as any).organization_id,
            database: (projectRes.data as any).database,
          }
        : null,
      project_error: projectRes.error || null,
      addons: {
        selected_addons: (addonsRes.data as any)?.selected_addons || [],
      },
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

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
