import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// G3-6 secret-read hardening: the secret VALUES are no longer read into the
// browser. Reads go through the `clients_public` view, which omits the 13
// credential columns and exposes a `has_<col>` boolean per secret instead.
// Writes still target the `clients` base table (see update* below). The 9
// secrets this hook used to surface are now `has_*` presence booleans.
export interface ClientCredentials {
  supabase_url: string | null;
  has_supabase_service_key: boolean;
  supabase_table_name: string | null;
  has_openai_api_key: boolean;
  has_openrouter_api_key: boolean;
  has_openrouter_management_key: boolean;
  has_elevenlabs_api_key: boolean;
  has_ghl_api_key: boolean;
  ghl_location_id: string | null;
  ghl_calendar_id: string | null;
  gohighlevel_booking_title: string | null;
  ghl_assignee_id: string | null;
  has_retell_api_key: boolean;
  retell_inbound_agent_id: string | null;
  retell_outbound_agent_id: string | null;
  retell_outbound_followup_agent_id: string | null;
  retell_agent_id_4: string | null;
  retell_phone_1: string | null;
  retell_phone_1_country_code: string | null;
  retell_phone_2: string | null;
  retell_phone_2_country_code: string | null;
  retell_phone_3: string | null;
  retell_phone_3_country_code: string | null;
  api_webhook_url: string | null;
  campaign_webhook_url: string | null;
  knowledge_base_add_webhook_url: string | null;
  prompt_webhook_url: string | null;
  analytics_webhook_url: string | null;
  ai_chat_webhook_url: string | null;
  chat_analytics_webhook_url: string | null;

  outbound_caller_webhook_1_url: string | null;
  outbound_caller_webhook_2_url: string | null;
  outbound_caller_webhook_3_url: string | null;
  transfer_to_human_webhook_url: string | null;
  save_reply_webhook_url: string | null;
  simulation_webhook: string | null;
  user_details_webhook_url: string | null;
  database_reactivation_inbound_webhook_url: string | null;
  lead_score_webhook_url: string | null;
  update_pipeline_webhook_url: string | null;
  has_supabase_access_token: boolean;
  twilio_account_sid: string | null;
  has_twilio_auth_token: boolean;
  twilio_default_phone: string | null;
  llm_model: string | null;
  setter_display_names: Record<string, string> | null;
}

// Secret base-table columns this hook used to read. Writes still go to these
// columns on `clients`; the optimistic cache only ever tracks `has_<col>`.
const SECRET_FIELDS = new Set<string>([
  'supabase_service_key',
  'supabase_access_token',
  'twilio_auth_token',
  'openrouter_api_key',
  'openrouter_management_key',
  'openai_api_key',
  'retell_api_key',
  'ghl_api_key',
  'elevenlabs_api_key',
]);

// Translate a (possibly secret) field write into the cache-shaped patch: a
// secret field becomes its `has_<col>` presence boolean so the value never
// lands in React Query cache; a non-secret field passes through unchanged.
function toCachePatch(
  field: string,
  value: string | null | Record<string, unknown>,
): Record<string, unknown> {
  if (SECRET_FIELDS.has(field)) {
    return { [`has_${field}`]: Boolean(typeof value === 'string' ? value.trim() : value) };
  }
  return { [field]: value };
}

const CREDENTIALS_FIELDS = `
  supabase_url,
  has_supabase_service_key,
  supabase_table_name,
  has_openai_api_key,
  has_openrouter_api_key,
  has_openrouter_management_key,
  has_elevenlabs_api_key,
  has_ghl_api_key,
  ghl_location_id,
  ghl_calendar_id,
  gohighlevel_booking_title,
  ghl_assignee_id,
  has_retell_api_key,
  retell_inbound_agent_id,
  retell_outbound_agent_id,
  retell_outbound_followup_agent_id,
  retell_agent_id_4,
  retell_phone_1,
  retell_phone_1_country_code,
  retell_phone_2,
  retell_phone_2_country_code,
  retell_phone_3,
  retell_phone_3_country_code,
  api_webhook_url,
  campaign_webhook_url,
  knowledge_base_add_webhook_url,
  prompt_webhook_url,
  analytics_webhook_url,
  ai_chat_webhook_url,
  chat_analytics_webhook_url,

  outbound_caller_webhook_1_url,
  outbound_caller_webhook_2_url,
  outbound_caller_webhook_3_url,
  transfer_to_human_webhook_url,
  save_reply_webhook_url,
  simulation_webhook,
  user_details_webhook_url,
  database_reactivation_inbound_webhook_url,
  lead_score_webhook_url,
  update_pipeline_webhook_url,
  has_supabase_access_token,
  twilio_account_sid,
  has_twilio_auth_token,
  twilio_default_phone,
  llm_model,
  setter_display_names
`.replace(/\s+/g, '');

async function fetchClientCredentials(clientId: string): Promise<ClientCredentials | null> {
  const { data, error } = await supabase
    .from('clients_public')
    .select(CREDENTIALS_FIELDS)
    .eq('id', clientId)
    .single();

  if (error) {
    console.error('Error fetching client credentials:', error);
    throw error;
  }

  return data as unknown as ClientCredentials;
}

async function updateClientCredential(
  clientId: string,
  field: string,
  value: string | null | Record<string, unknown>
): Promise<void> {
  const { data, error } = await supabase
    .from('clients')
    .update({ [field]: value })
    .eq('id', clientId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Update failed — no rows were updated. Please refresh the page and try again.');
  }
}

async function updateMultipleClientCredentials(
  clientId: string,
  updates: Record<string, string | null | Record<string, unknown>>
): Promise<void> {
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', clientId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Update failed — no rows were updated. Please refresh the page and try again.');
  }
}



export function useClientCredentials(clientId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['client-credentials', clientId],
    queryFn: () => fetchClientCredentials(clientId!),
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000, // Data considered fresh for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: string | null | Record<string, unknown> }) => {
      if (!clientId) throw new Error('No client ID');
      await updateClientCredential(clientId, field, value);


    },
    onMutate: async ({ field, value }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['client-credentials', clientId] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<ClientCredentials>(['client-credentials', clientId]);

      // Optimistically update the cache. Secret fields map to their has_<col>
      // presence boolean so the raw value never lands in React Query cache.
      if (previousData) {
        queryClient.setQueryData<ClientCredentials>(['client-credentials', clientId], {
          ...previousData,
          ...toCachePatch(field, value),
        });
      }

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['client-credentials', clientId], context.previousData);
      }
    },
    onSettled: () => {
      // Refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: ['client-credentials', clientId] });
    },
  });

  const updateMultipleMutation = useMutation({
    mutationFn: async ({ updates }: { updates: Record<string, string | null | Record<string, unknown>> }) => {
      if (!clientId) throw new Error('No client ID');
      await updateMultipleClientCredentials(clientId, updates);

    },
    onMutate: async ({ updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['client-credentials', clientId] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<ClientCredentials>(['client-credentials', clientId]);

      // Optimistically update the cache. Secret fields map to their has_<col>
      // presence boolean so raw values never land in React Query cache.
      if (previousData) {
        const cachePatch = Object.entries(updates).reduce<Record<string, unknown>>(
          (acc, [field, value]) => Object.assign(acc, toCachePatch(field, value)),
          {},
        );
        queryClient.setQueryData<ClientCredentials>(['client-credentials', clientId], {
          ...previousData,
          ...cachePatch,
        });
      }

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['client-credentials', clientId], context.previousData);
      }
    },
    onSettled: () => {
      // Refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: ['client-credentials', clientId] });
    },
  });

  return {
    credentials: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    updateCredential: updateMutation.mutateAsync,
    updateMultipleCredentials: updateMultipleMutation.mutateAsync,
    isUpdating: updateMutation.isPending || updateMultipleMutation.isPending,
    refetch: query.refetch,
  };
}

// Helper to check if a credential is configured
export function isCredentialConfigured(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}
