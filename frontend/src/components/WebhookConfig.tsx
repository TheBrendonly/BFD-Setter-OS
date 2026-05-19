
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link, CheckCircle, XCircle, Loader2 } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';

interface WebhookConfigProps {
  webhookUrl: string;
  onWebhookChange: (url: string) => void;
}

const WebhookConfig: React.FC<WebhookConfigProps> = ({ webhookUrl, onWebhookChange }) => {
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const { toast } = useToast();

  const testWebhookConnection = async () => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive",
      });
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('idle');

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        mode: 'no-cors', // This prevents CORS errors for testing
        body: JSON.stringify({
          test: true,
          message: 'Connection test from Database Reactivation Agent',
          timestamp: new Date().toISOString(),
        }),
      });

      // Since we're using no-cors mode, we can't read the response
      // but if no error is thrown, we assume it's successful
      setConnectionStatus('success');
      toast({
        title: "Connection successful",
        description: "Webhook endpoint is reachable",
      });
    } catch (error) {
      console.error('Webhook test error:', error);
      setConnectionStatus('error');
      toast({
        title: "Connection failed",
        description: "Unable to reach webhook endpoint",
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const getConnectionBadge = () => {
    switch (connectionStatus) {
      case 'success':
        return (
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="text-destructive border-destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Connection Error
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="material-surface p-8 animate-fade-in">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center space-x-2 mb-2">
          <Link className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-semibold text-on-surface">Webhook Configuration</h2>
        </div>
        <p className="text-on-surface-variant">Configure where to send lead data for processing</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-url" className="text-sm font-medium text-on-surface">
              n8n Webhook URL *
            </Label>
            {getConnectionBadge()}
          </div>
          
          <div className="flex space-x-2">
            <div className="flex-1">
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://your-n8n-host/webhook-test/..."
                value={webhookUrl}
                onChange={(e) => onWebhookChange(e.target.value)}
                className="material-input"
                disabled={isTestingConnection}
              />
            </div>
            
            <Button
              type="button"
              variant="outline"
              onClick={testWebhookConnection}
              disabled={isTestingConnection || !webhookUrl.trim()}
              className="flex items-center space-x-1"
            >
              {isTestingConnection ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              <span>{isTestingConnection ? 'Testing...' : 'Test'}</span>
            </Button>
          </div>
          
          <p className="text-xs text-on-surface-variant">
            Each lead will be sent individually to this webhook endpoint with lead data and campaign context
          </p>
        </div>

        {/* Webhook Payload Preview */}
        <div className="material-surface-variant p-4 rounded-lg">
          <h4 className="font-medium text-on-surface mb-3">Payload Example</h4>
          <pre className="text-xs text-on-surface-variant bg-surface rounded p-3 overflow-x-auto">
{`{
  "email": "john@example.com",
  "first_name": "John",
  "phone": "+1234567890",
  "campaign_name": "Q4 Reactivation Campaign",
  "reactivation_notes": "Special holiday offer",
  "timestamp": "2024-01-15T10:30:00Z"
}`}
          </pre>
        </div>

        {/* Connection Status Info */}
        <div className="text-sm text-on-surface-variant space-y-1">
          <p><span className="font-medium">Method:</span> POST</p>
          <p><span className="font-medium">Content-Type:</span> application/json</p>
          <p><span className="font-medium">Timeout:</span> 30 seconds</p>
          <p><span className="font-medium">Retries:</span> 3 attempts with exponential backoff</p>
        </div>
      </div>
    </div>
  );
};

export default WebhookConfig;
