import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';




// Test payload configurations for different webhook types
const TEST_PAYLOADS: Record<string, (clientId: string) => object> = {
  transfer_to_human_webhook_url: (clientId) => ({
    type: 'transfer_to_human_webhook_test',
    timestamp: new Date().toISOString(),
    client_id: clientId,
    test: true,
    message: 'Transfer to Human webhook configured successfully',
    sample_data: {
      contact_id: 'test_contact_123',
      phone: '+1234567890',
      reason: 'Customer requested human agent'
    }
  }),
  save_reply_webhook_url: (clientId) => ({
    type: 'save_reply_webhook_test',
    timestamp: new Date().toISOString(),
    client_id: clientId,
    test: true,
    message: 'Save Reply webhook configured successfully',
    sample_data: {
      contact_id: 'test_contact_123',
      message: 'Test AI reply message',
      channel: 'sms'
    }
  }),
  user_details_webhook_url: (clientId) => ({
    type: 'user_details_webhook_test',
    timestamp: new Date().toISOString(),
    client_id: clientId,
    test: true,
    message: 'User Details webhook configured successfully',
    sample_data: {
      contact_id: 'test_contact_123',
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com'
    }
  }),
  update_pipeline_webhook_url: (clientId) => ({
    type: 'pipeline_webhook_test',
    timestamp: new Date().toISOString(),
    client_id: clientId,
    test: true,
    message: 'Pipeline Update webhook configured successfully',
    sample_data: {
      contact_id: 'test_contact_123',
      pipeline_stage: 'New Lead',
      previous_stage: 'None'
    }
  }),
  lead_score_webhook_url: (clientId) => ({
    type: 'lead_score_webhook_test',
    timestamp: new Date().toISOString(),
    client_id: clientId,
    test: true,
    message: 'Lead Score webhook configured successfully',
    sample_data: {
      contact_id: 'test_contact_123',
      lead_score: 85,
      previous_score: 0
    }
  }),
  knowledge_base_add_webhook_url: (clientId) => ({
    type: 'knowledge_base_webhook_test',
    timestamp: new Date().toISOString(),
    client_id: clientId,
    test: true,
    message: 'Knowledge Base webhook configured successfully'
  })
};

// Webhook fields that should receive test payloads
const WEBHOOK_FIELDS = [
  'transfer_to_human_webhook_url',
  'save_reply_webhook_url',
  'user_details_webhook_url',
  'update_pipeline_webhook_url',
  'lead_score_webhook_url',

  'knowledge_base_add_webhook_url',
  'database_reactivation_inbound_webhook_url',
  'outbound_caller_webhook_1_url',
  'outbound_caller_webhook_2_url',
  'outbound_caller_webhook_3_url',
  'campaign_webhook_url',
  'prompt_webhook_url',
  'analytics_webhook_url',
  'ai_chat_webhook_url',
  'chat_analytics_webhook_url',
  'api_webhook_url'
];

interface UseWebhookSaveOptions {
  clientId: string;
  onSuccess?: () => void;
}

export const useWebhookSave = ({ clientId, onSuccess }: UseWebhookSaveOptions) => {
  const { toast } = useToast();

  // Validate webhook URL format
  const validateWebhookUrl = useCallback((url: string): { isValid: boolean; error?: string } => {
    if (!url || !url.trim()) {
      return { isValid: false, error: 'Webhook URL is required' };
    }
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        return { isValid: false, error: 'Webhook URL must use HTTP or HTTPS' };
      }
      return { isValid: true };
    } catch {
      return { isValid: false, error: 'Invalid URL format' };
    }
  }, []);

  // Send test payload to a webhook URL
  const sendTestPayload = useCallback(async (webhookUrl: string, fieldName: string) => {
    if (!webhookUrl?.trim()) return;
    
    const payloadGenerator = TEST_PAYLOADS[fieldName];
    const testPayload = payloadGenerator 
      ? payloadGenerator(clientId)
      : {
          type: 'webhook_test',
          field: fieldName,
          client_id: clientId,
          timestamp: new Date().toISOString(),
          message: 'Test payload sent after saving webhook configuration',
          test_data: {
            user_id: 'test_user_123',
            user_name: 'Test User',
            user_email: 'test@example.com',
            user_phone: '+15555555555'
          }
        };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });
      console.log(`Test payload sent to ${fieldName} webhook`);
    } catch (error) {
      console.error(`Error sending test payload to ${fieldName}:`, error);
    }
  }, [clientId]);




  // Main save function for any webhook field
  const saveWebhookField = useCallback(async (
    fieldName: string,
    webhookUrl: string,
    options?: { skipTestPayload?: boolean; skipBackendSync?: boolean }
  ): Promise<boolean> => {
    // Validate URL
    const validation = validateWebhookUrl(webhookUrl);
    if (!validation.isValid) {
      toast({
        title: 'Invalid Webhook URL',
        description: validation.error || 'Please provide a valid webhook URL',
        variant: 'destructive'
      });
      return false;
    }

    try {
      // Build update data - handle special cases
      const updateData: Record<string, string | null> = {};
      
      if (fieldName === 'knowledge_base_add_webhook_url' || fieldName === 'knowledge_base_webhook_url') {
        // Knowledge base webhook should update both add and delete columns
        updateData.knowledge_base_add_webhook_url = webhookUrl;
        updateData.knowledge_base_delete_webhook_url = webhookUrl;
      } else {
        updateData[fieldName] = webhookUrl;
      }

      // Save to database
      const { error } = await supabase
        .from('clients')
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to the webhook (if not skipped)
      if (!options?.skipTestPayload && WEBHOOK_FIELDS.includes(fieldName)) {
        await sendTestPayload(webhookUrl, fieldName);
      }




      toast({
        title: 'Success',
        description: `${fieldName.replace(/_/g, ' ')} saved successfully`
      });

      onSuccess?.();
      return true;
    } catch (error: any) {
      console.error('Error saving webhook:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save webhook',
        variant: 'destructive'
      });
      return false;
    }
  }, [clientId, validateWebhookUrl, sendTestPayload, toast, onSuccess]);

  // Save any field (not just webhooks)
  const saveField = useCallback(async (
    fieldName: string,
    value: string | null
  ): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('clients')
        .update({ [fieldName]: value })
        .eq('id', clientId);

      if (error) throw error;




      toast({
        title: 'Saved',
        description: `${fieldName.replace(/_/g, ' ')} saved successfully`
      });

      onSuccess?.();
      return true;
    } catch (error: any) {
      console.error('Error saving field:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save',
        variant: 'destructive'
      });
      return false;
    }
  }, [clientId, toast, onSuccess]);

  return {
    saveWebhookField,
    saveField,
    sendTestPayload,
    validateWebhookUrl
  };
};
