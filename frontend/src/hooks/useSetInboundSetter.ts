import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRetellApi, getInboundAgentId } from '@/hooks/useRetellApi';
import { toast } from 'sonner';

// F2(b): set/clear the single "inbound" voice setter for a client and auto-rebind
// the live Retell inbound number to that setter's agent.
//
// is_inbound on voice_setters is the source of truth (one-per-client partial unique
// index). Toggling ON also:
//   1. clears is_inbound on the client's other setters, sets it on this one,
//   2. points clients.retell_inbound_agent_id at this setter's agent (the column
//      retell-inbound-webhook resolves client-by-agent off), and
//   3. rebinds the client's inbound Retell number's inbound_agents to this agent.
// Toggling OFF only clears the flag; it does not unbind the Retell number.
export function useSetInboundSetter(clientId?: string) {
  const { listPhoneNumbers, updatePhoneNumber } = useRetellApi(clientId);
  const [binding, setBinding] = useState(false);

  const setInboundSetter = useCallback(
    async (slotNumber: number, on: boolean): Promise<boolean> => {
      if (!clientId || Number.isNaN(slotNumber)) return false;
      setBinding(true);
      try {
        // Resolve the voice_setters row for this slot.
        const { data: setter, error: setterErr } = await supabase
          .from('voice_setters')
          .select('id, retell_agent_id')
          .eq('client_id', clientId)
          .eq('legacy_slot', slotNumber)
          .maybeSingle();
        if (setterErr) throw setterErr;
        if (!setter) {
          toast.error('Save this setter first so it has a voice setter record.');
          return false;
        }

        if (!on) {
          // B-6: .select('id') so a 0-row update (silently RLS-filtered or a
          // stale id) surfaces instead of looking like a successful save.
          const { data: offRows, error } = await supabase
            .from('voice_setters')
            .update({ is_inbound: false })
            .eq('id', setter.id)
            .select('id');
          if (error) throw error;
          if (!offRows || offRows.length === 0) {
            toast.error('Could not clear the inbound flag (no row updated). Refresh and try again.');
            return false;
          }
          toast.success('Removed the inbound flag from this setter.');
          return true;
        }

        if (!setter.retell_agent_id) {
          toast.error('This setter has no Retell agent yet. Save it to create the agent, then try again.');
          return false;
        }

        // One inbound per client: clear others first, then set this one. The partial
        // unique index (voice_setters_one_inbound_per_client) is the backstop.
        const { error: clearErr } = await supabase
          .from('voice_setters')
          .update({ is_inbound: false })
          .eq('client_id', clientId)
          .neq('id', setter.id);
        if (clearErr) throw clearErr;
        // B-6: .select('id') so a 0-row update (silently RLS-filtered or a stale
        // id) surfaces + reverts the toggle instead of looking like a save.
        const { data: setRows, error: setErr } = await supabase
          .from('voice_setters')
          .update({ is_inbound: true })
          .eq('id', setter.id)
          .select('id');
        if (setErr) throw setErr;
        if (!setRows || setRows.length === 0) {
          toast.error('Could not flag this setter as inbound (no row updated). Refresh and try again.');
          return false;
        }

        // Find the live inbound number off the current inbound-agent cache.
        const { data: clientRow } = await supabase
          .from('clients_public')
          .select('retell_inbound_agent_id, retell_phone_1')
          .eq('id', clientId)
          .maybeSingle();
        const oldInboundAgent = (clientRow as any)?.retell_inbound_agent_id || null;
        const fallbackNumber = (clientRow as any)?.retell_phone_1 || null;

        // Point the client-by-agent resolver column at the new agent.
        await supabase
          .from('clients')
          .update({ retell_inbound_agent_id: setter.retell_agent_id })
          .eq('id', clientId);

        // Rebind the inbound Retell number to the new agent (best-effort: the DB
        // flag is the SoT, so a Retell hiccup here is surfaced but non-fatal).
        let inboundNumber: string | null = null;
        try {
          const numbers = await listPhoneNumbers();
          const list = Array.isArray(numbers) ? numbers : [];
          inboundNumber =
            (oldInboundAgent && list.find((p) => getInboundAgentId(p) === oldInboundAgent)?.phone_number) ||
            (fallbackNumber && list.find((p) => p.phone_number === fallbackNumber)?.phone_number) ||
            (list.length === 1 ? list[0].phone_number : null) ||
            null;
          if (inboundNumber) {
            await updatePhoneNumber(inboundNumber, {
              inbound_agents: [{ agent_id: setter.retell_agent_id, weight: 1 }],
            });
          }
        } catch (e) {
          console.error('Inbound Retell rebind failed:', e);
          toast.warning('Inbound flag saved, but the Retell number rebind failed. Re-bind it in API Credentials → Phone Numbers.');
          return true;
        }

        if (inboundNumber) {
          toast.success(`Inbound setter set. ${inboundNumber} now routes to this setter's agent.`);
        } else {
          toast.success('Inbound setter flag set. No inbound number was auto-detected — bind one in API Credentials → Phone Numbers.');
        }
        return true;
      } catch (err: any) {
        const msg =
          err?.code === '23505'
            ? 'Another setter is already the inbound setter — unset it first.'
            : err?.message || 'Failed to set the inbound setter.';
        toast.error(msg);
        return false;
      } finally {
        setBinding(false);
      }
    },
    [clientId, listPhoneNumbers, updatePhoneNumber],
  );

  return { setInboundSetter, binding };
}
