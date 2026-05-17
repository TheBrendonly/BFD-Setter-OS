import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.25.76';
import { parsePhoneNumberFromString } from 'https://esm.sh/libphonenumber-js@1.12.41/min';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LEAD_FILE_IMPORT = 'lead-file-import';
const LEAD_FILE_EXPORT = 'lead-file-export';
const IMPORT_INSERT_BATCH_SIZE = 100;
const IMPORT_UPDATE_BATCH_SIZE = 50;
const SELECT_BATCH_SIZE = 1000;
const ID_BATCH_SIZE = 500;
const STANDARD_FIELD_KEYS = new Set(['first_name', 'last_name', 'email', 'phone', 'business_name']);

const MappingSchema = z.object({
  csvColumn: z.string().min(1),
  mappedTo: z.string().min(1),
});

const ImportSchema = z.object({
  operation: z.literal('import'),
  clientId: z.string().uuid(),
  fileName: z.string().min(1).max(255).optional(),
  csvData: z.array(z.record(z.string(), z.any())),
  mappings: z.array(MappingSchema).min(1),
  duplicateHandling: z.enum(['skip', 'update']).default('skip'),
  assignTagIds: z.array(z.string().uuid()).default([]),
  clientRequestId: z.string().uuid().optional(),
});

const ExportSchema = z.object({
  operation: z.literal('export'),
  clientId: z.string().uuid(),
  fileName: z.string().min(1).max(255).optional(),
  selectionMode: z.enum(['all', 'ids']),
  selectedIds: z.array(z.string().uuid()).optional(),
  excludedIds: z.array(z.string().uuid()).optional(),
});

const BodySchema = z.discriminatedUnion('operation', [ImportSchema, ExportSchema]);

interface AuthorizedClient {
  id: string;
  agency_id: string | null;
  supabase_url: string | null;
  supabase_service_key: string | null;
  supabase_table_name: string | null;
}

interface ImportTag {
  name: string;
  color: string;
}

interface InsertLeadPayload {
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  custom_fields: Record<string, string>;
  tags: ImportTag[];
  lead_id: string;
  phone_valid: boolean;
  created_at?: string;
}

interface PreparedInsert {
  insert: InsertLeadPayload;
  rawTags: string;
}

interface PreparedUpdate {
  id: string;
  update: Record<string, unknown>;
  rawTags: string;
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ error: 'Supabase environment is not configured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: authData, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !authData.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const parsedBody = BodySchema.safeParse(await req.json());

    if (!parsedBody.success) {
      return jsonResponse({ error: parsedBody.error.flatten().fieldErrors }, 400);
    }

    const body = parsedBody.data;

    if (body.operation === 'export' && body.selectionMode === 'ids' && (!body.selectedIds || body.selectedIds.length === 0)) {
      return jsonResponse({ error: { selectedIds: ['selectedIds are required when selectionMode is ids'] } }, 400);
    }
    const client = await authorizeClientAccess(serviceClient, authData.user.id, body.clientId);

    if (!client) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const totalRows = body.operation === 'import'
      ? body.csvData.length
      : body.selectionMode === 'ids'
        ? body.selectedIds?.length || 0
        : 0;

    const jobType = body.operation === 'import' ? LEAD_FILE_IMPORT : LEAD_FILE_EXPORT;
    const { data: jobRow, error: jobError } = await serviceClient
      .from('ai_generation_jobs')
      .insert({
        client_id: body.clientId,
        job_type: jobType,
        status: 'pending',
        input_payload: {
          operation: body.operation,
          fileName: body.fileName,
          totalRows,
          duplicateHandling: body.operation === 'import' ? body.duplicateHandling : undefined,
          clientRequestId: body.operation === 'import' ? body.clientRequestId : undefined,
          selectionMode: body.operation === 'export' ? body.selectionMode : undefined,
        },
      })
      .select('id')
      .single();

    if (jobError || !jobRow) {
      console.error('Failed to create lead file job:', jobError);
      return jsonResponse({ error: 'Failed to start file job' }, 500);
    }

    const jobId = jobRow.id as string;
    const backgroundTask = body.operation === 'import'
      ? processImportJob(serviceClient, client, jobId, body)
      : processExportJob(serviceClient, jobId, body);

    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundTask);
    } else {
      void backgroundTask;
    }

    return jsonResponse({ job_id: jobId, status: 'pending' });
  } catch (error) {
    console.error('process-lead-file error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});

async function authorizeClientAccess(supabase: ReturnType<typeof createClient>, userId: string, clientId: string): Promise<AuthorizedClient | null> {
  const [{ data: client }, { data: roleData }, { data: profileData }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, agency_id, supabase_url, supabase_service_key, supabase_table_name')
      .eq('id', clientId)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('agency_id, client_id')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  if (!client || !roleData) {
    return null;
  }

  const isAuthorized = roleData.role === 'agency'
    ? !!profileData?.agency_id && profileData.agency_id === client.agency_id
    : roleData.role === 'client'
      ? profileData?.client_id === client.id
      : false;

  return isAuthorized ? (client as AuthorizedClient) : null;
}

async function processImportJob(
  supabase: ReturnType<typeof createClient>,
  client: AuthorizedClient,
  jobId: string,
  body: z.infer<typeof ImportSchema>,
) {
  const fileName = body.fileName || `leads-import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

  try {
    await updateLeadFileJob(supabase, jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      result: {
        operation: 'import',
        fileName,
        totalRows: body.csvData.length,
        processedRows: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        progressPercent: 0,
        stage: 'Reading rows',
      },
    });

    const tagsMapping = body.mappings.find((mapping) => mapping.mappedTo === 'tags');
    const { data: existingContacts, error: existingError } = await (supabase.from('leads') as any)
      .select('id, phone, email')
      .eq('client_id', body.clientId);

    if (existingError) throw existingError;

    const existingContactByPhone = new Map<string, string>();
    const existingContactByEmail = new Map<string, string>();

    (existingContacts || []).forEach((contact: { id: string; phone: string | null; email: string | null }) => {
      if (contact.phone) {
        const normalizedPhone = normalizePhone(contact.phone).normalized.toLowerCase();
        existingContactByPhone.set(normalizedPhone, contact.id);
      }
      if (contact.email) {
        existingContactByEmail.set(contact.email.toLowerCase().trim(), contact.id);
      }
    });

    const totalRows = body.csvData.length;
    const importBaseTime = Date.now();
    const contactsToInsert: PreparedInsert[] = [];
    const contactsToUpdate: PreparedUpdate[] = [];
    let skippedDuplicates = 0;

    for (let index = 0; index < body.csvData.length; index += 1) {
      const row = body.csvData[index];
      const mappedValues: Record<string, string> = {};
      let externalId: string | null = null;

      body.mappings.forEach((mapping) => {
        if (mapping.mappedTo === 'skip' || mapping.mappedTo === 'tags') return;

        const rawValue = normalizeText(row[mapping.csvColumn]);
        if (!rawValue) return;

        if (mapping.mappedTo === 'lead_id' || mapping.mappedTo === 'contact_id') {
          externalId = rawValue;
          return;
        }

        if (mapping.mappedTo.startsWith('custom:')) {
          mappedValues[mapping.mappedTo.replace('custom:', '')] = rawValue;
          return;
        }

        mappedValues[mapping.mappedTo] = rawValue;
      });

      const normalizedData = autoSplitContactName(mappedValues);
      const normalizedPhone = normalizedData.phone ? normalizePhone(normalizedData.phone) : null;
      const phone = normalizedPhone?.normalized || normalizedData.phone || null;
      const email = normalizedData.email?.trim() || null;
      const businessName = normalizedData.business_name?.trim() || null;
      const rawTags = tagsMapping ? normalizeText(row[tagsMapping.csvColumn]) : '';
      const tagsPayload = buildTagsPayload(rawTags);

      if (!phone && !email) {
        await maybeUpdateJobProgress(supabase, jobId, index + 1, body.csvData.length, contactsToInsert.length, contactsToUpdate.length, skippedDuplicates, 'Reading rows');
        continue;
      }

      const normPhone = phone ? phone.toLowerCase() : '';
      const normEmail = email ? email.toLowerCase().trim() : '';
      const duplicateId = (normPhone && existingContactByPhone.get(normPhone)) || (normEmail && existingContactByEmail.get(normEmail));

      if (duplicateId) {
        if (body.duplicateHandling === 'skip') {
          skippedDuplicates += 1;
        } else {
          const customFields = buildCustomFieldsFromData(normalizedData);
          contactsToUpdate.push({
            id: duplicateId,
            update: {
              first_name: normalizedData.first_name || undefined,
              last_name: normalizedData.last_name || undefined,
              phone: phone || undefined,
              email: email || undefined,
              business_name: businessName || undefined,
              custom_fields: customFields,
              tags: tagsPayload.length > 0 ? tagsPayload : undefined,
              phone_valid: normalizedPhone ? normalizedPhone.status !== 'warning' : true,
            },
            rawTags,
          });
        }

        await maybeUpdateJobProgress(supabase, jobId, index + 1, body.csvData.length, contactsToInsert.length, contactsToUpdate.length, skippedDuplicates, 'Reading rows');
        continue;
      }

      contactsToInsert.push({
        insert: {
          client_id: body.clientId,
          first_name: normalizedData.first_name || null,
          last_name: normalizedData.last_name || null,
          phone,
          email,
          business_name: businessName,
          custom_fields: buildCustomFieldsFromData(normalizedData),
          tags: tagsPayload,
          lead_id: externalId?.trim() || crypto.randomUUID(),
          phone_valid: normalizedPhone ? normalizedPhone.status !== 'warning' : true,
          created_at: new Date(importBaseTime + totalRows - index).toISOString(),
        },
        rawTags,
      });

      await maybeUpdateJobProgress(supabase, jobId, index + 1, body.csvData.length, contactsToInsert.length, contactsToUpdate.length, skippedDuplicates, 'Reading rows');
    }

    const insertedLeads: Array<{ id: string; lead_id: string; rawTags: string; insert: InsertLeadPayload }> = [];
    let insertedCount = 0;
    let updatedCount = 0;

    for (let index = 0; index < contactsToInsert.length; index += IMPORT_INSERT_BATCH_SIZE) {
      const batch = contactsToInsert.slice(index, index + IMPORT_INSERT_BATCH_SIZE);
      const { data, error } = await (supabase.from('leads') as any)
        .insert(batch.map((item) => item.insert))
        .select('id, lead_id');

      if (error) throw error;

      (data || []).forEach((row: { id: string; lead_id: string }, rowIndex: number) => {
        const source = batch[rowIndex];
        if (!source) return;
        insertedLeads.push({
          id: row.id,
          lead_id: row.lead_id || source.insert.lead_id,
          rawTags: source.rawTags,
          insert: source.insert,
        });
      });

      insertedCount += batch.length;

      await updateLeadFileJob(supabase, jobId, {
        result: {
          operation: 'import',
          fileName,
          totalRows: body.csvData.length,
          processedRows: insertedCount + updatedCount + skippedDuplicates,
          insertedCount,
          updatedCount,
          skippedCount: skippedDuplicates,
          progressPercent: 35 + Math.round((insertedCount / Math.max(1, contactsToInsert.length + contactsToUpdate.length)) * 40),
          stage: 'Writing leads',
        },
      });
    }

    for (let index = 0; index < contactsToUpdate.length; index += IMPORT_UPDATE_BATCH_SIZE) {
      const batch = contactsToUpdate.slice(index, index + IMPORT_UPDATE_BATCH_SIZE);

      for (const item of batch) {
        const cleanUpdate = Object.fromEntries(Object.entries(item.update).filter(([, value]) => value !== undefined));
        if (Object.keys(cleanUpdate).length > 0) {
          const { error } = await (supabase.from('leads') as any).update(cleanUpdate).eq('id', item.id);
          if (error) throw error;
        }
        updatedCount += 1;
      }

      await updateLeadFileJob(supabase, jobId, {
        result: {
          operation: 'import',
          fileName,
          totalRows: body.csvData.length,
          processedRows: insertedCount + updatedCount + skippedDuplicates,
          insertedCount,
          updatedCount,
          skippedCount: skippedDuplicates,
          progressPercent: 35 + Math.round(((insertedCount + updatedCount) / Math.max(1, contactsToInsert.length + contactsToUpdate.length)) * 40),
          stage: 'Writing leads',
        },
      });
    }

    await syncImportTagsAndCustomFields(supabase, body.clientId, tagsMapping, insertedLeads, contactsToUpdate, body.assignTagIds);

    await updateLeadFileJob(supabase, jobId, {
      result: {
        operation: 'import',
        fileName,
        totalRows: body.csvData.length,
        processedRows: insertedCount + updatedCount + skippedDuplicates,
        insertedCount,
        updatedCount,
        skippedCount: skippedDuplicates,
        progressPercent: 90,
        stage: 'Finalizing import',
      },
    });

    if (client.supabase_url && client.supabase_service_key && insertedLeads.length > 0) {
      await pushInsertedLeadsToExternal(client, insertedLeads);
    }

    await updateLeadFileJob(supabase, jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        operation: 'import',
        fileName,
        totalRows: body.csvData.length,
        processedRows: insertedCount + updatedCount + skippedDuplicates,
        insertedCount,
        updatedCount,
        skippedCount: skippedDuplicates,
        progressPercent: 100,
        stage: 'Complete',
      },
    });
  } catch (error) {
    console.error('Lead import failed:', error);
    await updateLeadFileJob(supabase, jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : 'Import failed',
    });
  }
}

async function processExportJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  body: z.infer<typeof ExportSchema>,
) {
  const fileName = body.fileName || `leads-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

  try {
    let totalRows = 0;

    if (body.selectionMode === 'all') {
      const { count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', body.clientId);
      totalRows = Math.max(0, (count || 0) - (body.excludedIds?.length || 0));
    } else {
      totalRows = body.selectedIds?.length || 0;
    }

    await updateLeadFileJob(supabase, jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      result: {
        operation: 'export',
        fileName,
        totalRows,
        processedRows: 0,
        progressPercent: 0,
        stage: 'Fetching leads',
      },
    });

    const excludedIdSet = new Set(body.excludedIds || []);
    const selectedLeads = await fetchLeadsForExport(supabase, body, excludedIdSet, jobId, fileName, totalRows);
    const aiColumns = await fetchLeadAIColumns(supabase, body.clientId);
    const aiValues = await fetchLeadAIValues(supabase, selectedLeads.map((lead) => lead.id), jobId, fileName, totalRows);
    const csvText = buildLeadsCsv(selectedLeads, aiColumns, aiValues);

    await updateLeadFileJob(supabase, jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        operation: 'export',
        fileName,
        totalRows: selectedLeads.length,
        processedRows: selectedLeads.length,
        progressPercent: 100,
        stage: 'Complete',
        csvBase64: encodeBase64(new TextEncoder().encode(csvText)),
      },
    });
  } catch (error) {
    console.error('Lead export failed:', error);
    await updateLeadFileJob(supabase, jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : 'Export failed',
    });
  }
}

async function fetchLeadsForExport(
  supabase: ReturnType<typeof createClient>,
  body: z.infer<typeof ExportSchema>,
  excludedIdSet: Set<string>,
  jobId: string,
  fileName: string,
  totalRows: number,
) {
  const leads: Array<Record<string, unknown>> = [];

  if (body.selectionMode === 'all') {
    let from = 0;

    while (true) {
      const { data, error } = await (supabase.from('leads') as any)
        .select('*')
        .eq('client_id', body.clientId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + SELECT_BATCH_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      leads.push(...data.filter((lead: { id: string }) => !excludedIdSet.has(lead.id)));
      from += SELECT_BATCH_SIZE;

      await updateLeadFileJob(supabase, jobId, {
        result: {
          operation: 'export',
          fileName,
          totalRows,
          processedRows: Math.min(leads.length, totalRows),
          progressPercent: Math.min(45, Math.round((Math.min(leads.length, totalRows) / Math.max(1, totalRows)) * 45)),
          stage: 'Fetching leads',
        },
      });

      if (data.length < SELECT_BATCH_SIZE) break;
    }

    return leads;
  }

  const selectedIds = body.selectedIds || [];
  for (let index = 0; index < selectedIds.length; index += ID_BATCH_SIZE) {
    const chunk = selectedIds.slice(index, index + ID_BATCH_SIZE);
    const { data, error } = await (supabase.from('leads') as any)
      .select('*')
      .in('id', chunk);

    if (error) throw error;
    leads.push(...(data || []));

    await updateLeadFileJob(supabase, jobId, {
      result: {
        operation: 'export',
        fileName,
        totalRows,
        processedRows: Math.min(index + chunk.length, totalRows),
        progressPercent: Math.min(45, Math.round((Math.min(index + chunk.length, totalRows) / Math.max(1, totalRows)) * 45)),
        stage: 'Fetching leads',
      },
    });
  }

  const orderMap = new Map(selectedIds.map((id, index) => [id, index]));
  return leads.sort((left, right) => (orderMap.get(String(left.id)) || 0) - (orderMap.get(String(right.id)) || 0));
}

async function fetchLeadAIColumns(supabase: ReturnType<typeof createClient>, clientId: string) {
  const { data, error } = await (supabase.from('lead_ai_columns') as any)
    .select('id, column_name')
    .eq('client_id', clientId);

  if (error) throw error;
  return (data || []) as Array<{ id: string; column_name: string }>;
}

async function fetchLeadAIValues(
  supabase: ReturnType<typeof createClient>,
  leadIds: string[],
  jobId: string,
  fileName: string,
  totalRows: number,
) {
  const values: Array<{ lead_id: string; ai_column_id: string; generated_value: string | null }> = [];

  for (let index = 0; index < leadIds.length; index += ID_BATCH_SIZE) {
    const chunk = leadIds.slice(index, index + ID_BATCH_SIZE);
    if (chunk.length === 0) continue;

    const { data, error } = await (supabase.from('lead_ai_values') as any)
      .select('lead_id, ai_column_id, generated_value')
      .in('lead_id', chunk);

    if (error) throw error;
    values.push(...(data || []));

    await updateLeadFileJob(supabase, jobId, {
      result: {
        operation: 'export',
        fileName,
        totalRows,
        processedRows: Math.min(index + chunk.length, totalRows),
        progressPercent: 45 + Math.round((Math.min(index + chunk.length, totalRows) / Math.max(1, totalRows)) * 25),
        stage: 'Collecting AI columns',
      },
    });
  }

  return values;
}

function buildLeadsCsv(
  leads: Array<Record<string, unknown>>,
  aiColumns: Array<{ id: string; column_name: string }>,
  aiValues: Array<{ lead_id: string; ai_column_id: string; generated_value: string | null }>,
) {
  const customFieldKeys = Array.from(new Set(
    leads.flatMap((lead) => Object.keys((lead.custom_fields as Record<string, unknown> | null) || {})),
  )).sort();

  const aiValueMap = new Map(aiValues.map((value) => [`${value.lead_id}:${value.ai_column_id}`, value.generated_value || '']));
  const headers = [
    'id',
    'lead_id',
    'client_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'business_name',
    'created_at',
    'phone_valid',
    'tags',
    ...customFieldKeys,
    ...aiColumns.map((column) => column.column_name),
  ];

  const rows = leads.map((lead) => {
    const customFields = (lead.custom_fields as Record<string, unknown> | null) || {};
    const tags = Array.isArray(lead.tags)
      ? (lead.tags as Array<{ name?: string }>).map((tag) => tag?.name || '').filter(Boolean).join(', ')
      : '';

    const baseRow: Record<string, unknown> = {
      id: lead.id,
      lead_id: lead.lead_id,
      client_id: lead.client_id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      business_name: lead.business_name,
      created_at: lead.created_at,
      phone_valid: lead.phone_valid,
      tags,
    };

    customFieldKeys.forEach((key) => {
      baseRow[key] = customFields[key] ?? '';
    });

    aiColumns.forEach((column) => {
      baseRow[column.column_name] = aiValueMap.get(`${String(lead.id)}:${column.id}`) || '';
    });

    return headers.map((header) => escapeCsvValue(baseRow[header]));
  });

  return [headers.map(escapeCsvValue).join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string'
    ? value
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

async function syncImportTagsAndCustomFields(
  supabase: ReturnType<typeof createClient>,
  clientId: string,
  tagsMapping: { csvColumn: string; mappedTo: string } | undefined,
  insertedLeads: Array<{ id: string; rawTags: string; insert: InsertLeadPayload }>,
  contactsToUpdate: PreparedUpdate[],
  assignTagIds: string[] = [],
) {
  if (tagsMapping && [...insertedLeads, ...contactsToUpdate].some((lead) => lead.rawTags.trim())) {
    const tagNames = new Set<string>();

    [...insertedLeads, ...contactsToUpdate].forEach((lead) => {
      lead.rawTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => tagNames.add(tag));
    });

    if (tagNames.size > 0) {
      const { data: existingTags, error: tagLookupError } = await (supabase.from('lead_tags') as any)
        .select('id, name')
        .eq('client_id', clientId);

      if (tagLookupError) throw tagLookupError;

      const tagMap = new Map<string, string>();
      (existingTags || []).forEach((tag: { id: string; name: string }) => tagMap.set(tag.name.toLowerCase(), tag.id));

      const tagsToCreate = Array.from(tagNames).filter((name) => !tagMap.has(name.toLowerCase()));
      if (tagsToCreate.length > 0) {
        const { data: insertedTags, error: insertTagError } = await (supabase.from('lead_tags') as any)
          .insert(tagsToCreate.map((name) => ({ client_id: clientId, name, color: '#646E82' })))
          .select('id, name');

        if (insertTagError) throw insertTagError;
        (insertedTags || []).forEach((tag: { id: string; name: string }) => tagMap.set(tag.name.toLowerCase(), tag.id));
      }

      const assignments = insertedLeads.flatMap((lead) =>
        lead.rawTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => ({ lead_id: lead.id, tag_id: tagMap.get(tag.toLowerCase()) }))
          .filter((assignment): assignment is { lead_id: string; tag_id: string } => Boolean(assignment.tag_id)),
      );

      for (let index = 0; index < assignments.length; index += IMPORT_INSERT_BATCH_SIZE) {
        const batch = assignments.slice(index, index + IMPORT_INSERT_BATCH_SIZE);
        const { error } = await (supabase.from('lead_tag_assignments') as any).insert(batch);
        if (error) throw error;
      }
    }
  }

  // Bulk-assign tags selected in the import dialog (assignTagIds)
  if (assignTagIds.length > 0) {
    const allLeadIds = [
      ...insertedLeads.map((l) => l.id),
      ...contactsToUpdate.map((l) => l.id),
    ];

    if (allLeadIds.length > 0) {
      const bulkAssignments = allLeadIds.flatMap((leadId) =>
        assignTagIds.map((tagId) => ({ lead_id: leadId, tag_id: tagId })),
      );

      for (let index = 0; index < bulkAssignments.length; index += IMPORT_INSERT_BATCH_SIZE) {
        const batch = bulkAssignments.slice(index, index + IMPORT_INSERT_BATCH_SIZE);
        const { error } = await (supabase.from('lead_tag_assignments') as any)
          .upsert(batch, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true });
        if (error) throw error;
      }
    }
  }

  const allCustomFieldNames = new Set<string>();
  insertedLeads.forEach((lead) => Object.keys(lead.insert.custom_fields || {}).forEach((key) => allCustomFieldNames.add(key)));

  if (allCustomFieldNames.size > 0) {
    const { data: existingDefs, error: defsError } = await (supabase.from('client_custom_fields') as any)
      .select('field_name, sort_order')
      .eq('client_id', clientId);

    if (defsError) throw defsError;

    const existingNames = new Set((existingDefs || []).map((field: { field_name: string }) => field.field_name));
    const nextSortOrder = ((existingDefs || []).reduce((max: number, field: { sort_order: number | null }) => Math.max(max, field.sort_order || -1), -1)) + 1;
    let sortOrder = nextSortOrder;

    const defsToInsert = Array.from(allCustomFieldNames)
      .filter((fieldName) => !existingNames.has(fieldName))
      .map((fieldName) => ({
        client_id: clientId,
        field_name: fieldName,
        sort_order: sortOrder++,
      }));

    if (defsToInsert.length > 0) {
      const { error } = await (supabase.from('client_custom_fields') as any).insert(defsToInsert);
      if (error) throw error;
    }
  }
}

async function pushInsertedLeadsToExternal(
  client: AuthorizedClient,
  leads: Array<{ lead_id: string; insert: InsertLeadPayload }>,
) {
  if (!client.supabase_url || !client.supabase_service_key) return;

  const external = createClient(client.supabase_url, client.supabase_service_key);
  const tableName = client.supabase_table_name?.trim() || 'leads';

  // Track which columns are unsupported so we can skip them for all subsequent rows
  const unsupportedColumns = new Set<string>();

  // Process in batches of 50 for batch insert
  const BATCH_SIZE = 50;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const records = batch.map((lead) => {
      const record: Record<string, unknown> = {
        lead_id: lead.lead_id,
        first_name: lead.insert.first_name,
        last_name: lead.insert.last_name,
        phone: lead.insert.phone,
        email: lead.insert.email,
        business_name: lead.insert.business_name,
        tags: lead.insert.tags,
        custom_fields: lead.insert.custom_fields,
        updated_at: new Date().toISOString(),
      };
      // Remove known unsupported columns
      for (const col of unsupportedColumns) {
        delete record[col];
      }
      return record;
    });

    // Try batch insert with retry for missing columns
    let currentRecords = records;
    let success = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { error } = await external.from(tableName).insert(currentRecords);
      if (!error) {
        success = true;
        break;
      }
      const missingColumn = error.message?.match(/Could not find the '([^']+)' column/);
      if (missingColumn?.[1]) {
        const badCol = missingColumn[1];
        unsupportedColumns.add(badCol);
        currentRecords = currentRecords.map((r) => {
          const copy = { ...r };
          delete copy[badCol];
          return copy;
        });
        continue;
      }
      // Non-column error: fallback to one-by-one for this batch
      console.error(`Batch insert failed at offset ${i}, falling back to individual inserts:`, error.message);
      for (const record of currentRecords) {
        const { error: singleErr } = await persistWithFallback(external, tableName, record, 'insert');
        if (singleErr) console.error('Failed to insert external lead:', singleErr);
      }
      success = true;
      break;
    }
    if (!success) {
      console.error(`Giving up on batch at offset ${i} after too many column stripping attempts`);
    }
  }
}

async function persistWithFallback(
  client: ReturnType<typeof createClient>,
  tableName: string,
  record: Record<string, unknown>,
  mode: 'insert' | 'update',
  existingId?: string,
) {
  const currentRecord = { ...record };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = mode === 'update' && existingId
      ? await client.from(tableName).update(currentRecord).eq('id', existingId)
      : await client.from(tableName).insert(currentRecord);

    if (!result.error) {
      return { error: null };
    }

    const missingColumn = result.error.message?.match(/Could not find the '([^']+)' column/);
    if (missingColumn?.[1]) {
      delete currentRecord[missingColumn[1]];
      continue;
    }

    return { error: result.error.message };
  }

  return { error: 'Too many unsupported external columns' };
}

async function maybeUpdateJobProgress(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  processedRows: number,
  totalRows: number,
  insertedCount: number,
  updatedCount: number,
  skippedCount: number,
  stage: string,
) {
  const updateInterval = totalRows <= 100 ? 10 : totalRows <= 500 ? 50 : 250;
  if (processedRows % updateInterval !== 0 && processedRows !== totalRows) return;

  await updateLeadFileJob(supabase, jobId, {
    result: {
      operation: 'import',
      totalRows,
      processedRows,
      insertedCount,
      updatedCount,
      skippedCount,
      progressPercent: Math.min(35, Math.round((processedRows / Math.max(1, totalRows)) * 35)),
      stage,
    },
  });
}

async function updateLeadFileJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('ai_generation_jobs')
    .update(payload)
    .eq('id', jobId);

  if (error) {
    console.error('Failed to update lead file job:', error);
  }
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function autoSplitContactName(data: Record<string, string>) {
  if (data.first_name || data.last_name) return data;

  const nameValue = data.full_name || data.name || '';
  if (!nameValue) return data;

  const parts = nameValue.trim().split(/\s+/);
  if (parts.length === 1) {
    return { ...data, first_name: parts[0] };
  }

  return {
    ...data,
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
  };
}

function buildCustomFieldsFromData(data: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => !STANDARD_FIELD_KEYS.has(key) && value)
      .map(([key, value]) => [key, value]),
  );
}

function buildTagsPayload(rawTags: string) {
  const seen = new Set<string>();
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const normalizedTag = tag.toLowerCase();
      if (seen.has(normalizedTag)) return false;
      seen.add(normalizedTag);
      return true;
    })
    .map((name) => ({ name, color: '#646E82' }));
}

function normalizePhone(phone: string) {
  const trimmedPhone = phone.trim();
  const cleaned = trimmedPhone.replace(/[\s\-.()\u00A0]/g, '');

  // Ensure + prefix
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;

  // Try to parse and format nicely, but always accept the number
  const parsed = parsePhoneNumberFromString(withPlus);
  if (parsed) {
    return {
      normalized: parsed.number,
      status: 'valid' as const,
    };
  }

  // Could not parse at all — still keep it with + prefix
  return { normalized: withPlus, status: 'valid' as const };
}