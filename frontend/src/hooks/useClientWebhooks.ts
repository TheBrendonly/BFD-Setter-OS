import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ClientWebhooks {
  knowledge_base_add_webhook_url: string | null;
  knowledge_base_delete_webhook_url: string | null;
  prompt_webhook_url: string | null;
  analytics_webhook_url: string | null;
  ai_chat_webhook_url: string | null;
  transfer_to_human_webhook_url: string | null;
  user_details_webhook_url: string | null;
}

export const useClientWebhooks = (clientId: string | undefined) => {
  const [webhooks, setWebhooks] = useState<ClientWebhooks>({
    knowledge_base_add_webhook_url: null,
    knowledge_base_delete_webhook_url: null,
    prompt_webhook_url: null,
    analytics_webhook_url: null,
    ai_chat_webhook_url: null,
    transfer_to_human_webhook_url: null,
    user_details_webhook_url: null,
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (clientId) {
      fetchWebhooks();
    }
  }, [clientId]);

  const fetchWebhooks = async () => {
    if (!clientId) return;

    try {
      const { data, error } = await supabase
        .from('clients_public')
        .select('knowledge_base_add_webhook_url, knowledge_base_delete_webhook_url, prompt_webhook_url, analytics_webhook_url, ai_chat_webhook_url, transfer_to_human_webhook_url, user_details_webhook_url')
        .eq('id', clientId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        console.warn('No client found or no access to client for webhook fetch.');
        setWebhooks({
          knowledge_base_add_webhook_url: null,
          knowledge_base_delete_webhook_url: null,
          prompt_webhook_url: null,
          analytics_webhook_url: null,
          ai_chat_webhook_url: null,
          transfer_to_human_webhook_url: null,
          user_details_webhook_url: null,
        });
        toast({
          title: 'No access to client webhooks',
          description: 'Either this client does not exist or you do not have access.',
          variant: 'destructive'
        });
        return;
      }
      setWebhooks(data);
    } catch (error) {
      console.error('Error fetching client webhooks:', error);
      toast({
        title: "Error",
        description: "Failed to fetch webhook settings",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateWebhooks = async (updates: Partial<ClientWebhooks>) => {
    if (!clientId) return false;

    try {
      const { error } = await supabase
        .from('clients')
        .update(updates)
        .eq('id', clientId);

      if (error) throw error;

      setWebhooks(prev => ({ ...prev, ...updates }));
      toast({
        title: "Webhooks updated",
        description: "Webhook settings have been saved successfully"
      });
      return true;
    } catch (error) {
      console.error('Error updating webhooks:', error);
      toast({
        title: "Error",
        description: "Failed to update webhook settings",
        variant: "destructive"
      });
      return false;
    }
  };

  return {
    webhooks,
    loading,
    updateWebhooks,
    refetch: fetchWebhooks
  };
};