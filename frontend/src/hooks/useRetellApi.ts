import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';

// Error carrying the retell-proxy structured body (code/status) so callers can
// branch — e.g. the F9 lock (code 'setter_retell_locked', status 423).
export interface RetellProxyError extends Error {
  code?: string;
  status?: number;
}

// Typed wrapper around the retell-proxy edge function
export function useRetellApi(clientId: string | undefined) {
  const invoke = useCallback(
    async <T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> => {
      if (!clientId) throw new Error('No client ID');

      const { data, error } = await supabase.functions.invoke('retell-proxy', {
        body: { action, clientId, ...params },
      });

      if (error) {
        // Non-2xx responses come back as FunctionsHttpError with the JSON body on
        // error.context — without reading it the structured {error, code} (and the
        // HTTP status) are lost, so a 423 lock surfaced as a generic message.
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => ({}));
          const e = new Error(body?.error || error.message) as RetellProxyError;
          e.code = body?.code;
          e.status = error.context.status;
          throw e;
        }
        throw new Error(error.message);
      }
      if (data?.error) throw new Error(data.error);
      return data as T;
    },
    [clientId]
  );

  // ===== AGENTS =====
  const listAgents = useCallback(() => invoke<RetellAgent[]>('list-agents'), [invoke]);

  const getAgent = useCallback(
    (agentId: string) => invoke<RetellAgent>('get-agent', { agentId }),
    [invoke]
  );

  const createAgent = useCallback(
    (agentData: Record<string, unknown>) => invoke<RetellAgent>('create-agent', { agentData }),
    [invoke]
  );

  const updateAgent = useCallback(
    (agentId: string, agentData: Record<string, unknown>) =>
      invoke<RetellAgent>('update-agent', { agentId, agentData }),
    [invoke]
  );

  const deleteAgent = useCallback(
    (agentId: string) => invoke('delete-agent', { agentId }),
    [invoke]
  );

  // ===== LLMs =====
  const listLlms = useCallback(() => invoke<RetellLlm[]>('list-llms'), [invoke]);

  const getLlm = useCallback(
    (llmId: string) => invoke<RetellLlm>('get-llm', { llmId }),
    [invoke]
  );

  const createLlm = useCallback(
    (llmData: Record<string, unknown>) => invoke<RetellLlm>('create-llm', { llmData }),
    [invoke]
  );

  const updateLlm = useCallback(
    (llmId: string, llmData: Record<string, unknown>) =>
      invoke<RetellLlm>('update-llm', { llmId, llmData }),
    [invoke]
  );

  const deleteLlm = useCallback(
    (llmId: string) => invoke('delete-llm', { llmId }),
    [invoke]
  );

  // ===== KNOWLEDGE BASE =====
  const listKnowledgeBases = useCallback(
    () => invoke<RetellKnowledgeBase[]>('list-knowledge-bases'),
    [invoke]
  );

  const getKnowledgeBase = useCallback(
    (kbId: string) => invoke<RetellKnowledgeBase>('get-knowledge-base', { kbId }),
    [invoke]
  );

  const createKnowledgeBase = useCallback(
    (kbData: Record<string, unknown>) =>
      invoke<RetellKnowledgeBase>('create-knowledge-base', { kbData }),
    [invoke]
  );

  const deleteKnowledgeBase = useCallback(
    (kbId: string) => invoke('delete-knowledge-base', { kbId }),
    [invoke]
  );

  // ===== PHONE NUMBERS =====
  const listPhoneNumbers = useCallback(
    () => invoke<RetellPhoneNumber[]>('list-phone-numbers'),
    [invoke]
  );

  const importPhoneNumber = useCallback(
    (phoneData: Record<string, unknown>) =>
      invoke<RetellPhoneNumber>('import-phone-number', { phoneData }),
    [invoke]
  );

  const updatePhoneNumber = useCallback(
    (phoneNumber: string, phoneData: Record<string, unknown>) =>
      invoke<RetellPhoneNumber>('update-phone-number', { phoneNumber, phoneData }),
    [invoke]
  );

  const deletePhoneNumber = useCallback(
    (phoneNumber: string) => invoke('delete-phone-number', { phoneNumber }),
    [invoke]
  );

  // ===== CALLS =====
  const listCalls = useCallback(() => invoke<RetellCall[]>('list-calls'), [invoke]);

  const getCall = useCallback(
    (callId: string) => invoke<RetellCall>('get-call', { callId }),
    [invoke]
  );

  const createPhoneCall = useCallback(
    (callData: Record<string, unknown>) =>
      invoke<RetellCall>('create-phone-call', { callData }),
    [invoke]
  );

  // ===== VOICES =====
  const listVoices = useCallback(() => invoke<RetellVoice[]>('list-voices'), [invoke]);

  return {
    // Agents
    listAgents, getAgent, createAgent, updateAgent, deleteAgent,
    // LLMs
    listLlms, getLlm, createLlm, updateLlm, deleteLlm,
    // Knowledge Base
    listKnowledgeBases, getKnowledgeBase, createKnowledgeBase, deleteKnowledgeBase,
    // Phone Numbers
    listPhoneNumbers, importPhoneNumber, updatePhoneNumber, deletePhoneNumber,
    // Calls
    listCalls, getCall, createPhoneCall,
    // Voices
    listVoices,
    // Raw invoke for custom actions
    invoke,
  };
}

// ===== Types =====
export interface RetellAgent {
  agent_id: string;
  agent_name: string | null;
  version: number;
  is_published: boolean;
  voice_id: string;
  voice_model?: string | null;
  voice_temperature?: number;
  voice_speed?: number;
  volume?: number;
  responsiveness?: number;
  interruption_sensitivity?: number;
  enable_backchannel?: boolean;
  ambient_sound?: string | null;
  language?: string;
  webhook_url?: string | null;
  begin_message_delay_ms?: number;
  max_call_duration_ms?: number;
  end_call_after_silence_ms?: number;
  normalize_for_speech?: boolean;
  last_modification_timestamp: number;
  response_engine?: {
    type: string;
    llm_id?: string;
    version?: number;
  };
  post_call_analysis_data?: Array<{
    name: string;
    type: string;
    description: string;
    choices?: string[];
  }>;
  voicemail_option?: Record<string, unknown>;
}

export interface RetellLlm {
  llm_id: string;
  version: number;
  is_published: boolean;
  model: string;
  model_temperature?: number;
  model_high_priority?: boolean;
  general_prompt?: string;
  begin_message?: string;
  start_speaker?: string;
  general_tools?: Array<Record<string, unknown>>;
  knowledge_base_ids?: string[];
  last_modification_timestamp: number;
}

export interface RetellKnowledgeBase {
  knowledge_base_id: string;
  knowledge_base_name: string;
  status: string;
  knowledge_base_sources?: Array<{
    type: string;
    source_id: string;
    filename?: string;
    file_url?: string;
  }>;
  enable_auto_refresh?: boolean;
  last_refreshed_timestamp?: number;
}

// Retell's weighted-agent-list element (replaces the deprecated single-agent
// fields on the phone-number API: inbound_agent_id / outbound_agent_id, etc).
export interface AgentWeight {
  agent_id: string;
  agent_version?: number;
  weight: number;
}

export interface RetellPhoneNumber {
  phone_number: string;
  phone_number_pretty?: string;
  phone_number_type?: string;
  // Current (post-deprecation) shape: weighted agent lists.
  inbound_agents?: AgentWeight[] | null;
  outbound_agents?: AgentWeight[] | null;
  // Deprecated single-agent fields, kept for backward-compatible reads.
  inbound_agent_id?: string | null;
  outbound_agent_id?: string | null;
  nickname?: string | null;
  last_modification_timestamp?: number;
}

// Read the primary assigned agent for a phone. A *present* weighted-list array is
// authoritative — including an empty array, which means "unassigned". Only fall
// back to the deprecated single-agent field when the array is absent
// (undefined/null), so an unassign (writes []) doesn't read back a ghost agent
// from the still-populated deprecated field during Retell's interim back-compat.
export const getInboundAgentId = (p: RetellPhoneNumber): string | null =>
  Array.isArray(p.inbound_agents)
    ? p.inbound_agents[0]?.agent_id ?? null
    : p.inbound_agent_id ?? null;
export const getOutboundAgentId = (p: RetellPhoneNumber): string | null =>
  Array.isArray(p.outbound_agents)
    ? p.outbound_agents[0]?.agent_id ?? null
    : p.outbound_agent_id ?? null;

export interface RetellCall {
  call_id: string;
  call_type: string;
  call_status: string;
  agent_id: string;
  agent_name?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  transcript?: string;
  recording_url?: string;
  public_log_url?: string;
  call_analysis?: Record<string, unknown>;
  disconnection_reason?: string;
}

export interface RetellVoice {
  voice_id: string;
  voice_name: string;
  provider: string;
  accent?: string;
  gender?: string;
  age?: string;
  preview_audio_url?: string | null;
  recommended?: boolean;
  voice_type?: string;
  avatar_url?: string | null;
}
