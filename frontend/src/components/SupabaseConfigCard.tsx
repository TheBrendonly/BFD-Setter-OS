import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Database, Edit, Save, Settings, Eye, EyeOff, RotateCcw } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface SupabaseConfigCardProps {
  clientId: string;
  config: {
    supabase_service_key?: string | null;
    supabase_table_name?: string | null;
    supabase_url?: string | null;
  };
  onUpdate: () => void;
}

export const SupabaseConfigCard: React.FC<SupabaseConfigCardProps> = ({
  clientId,
  config,
  onUpdate
}) => {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showServiceKey, setShowServiceKey] = useState(false);
  const [formData, setFormData] = useState({
    supabase_service_key: config.supabase_service_key || '',
    supabase_url: config.supabase_url || ''
  });

  const hasConfig = config.supabase_service_key && config.supabase_url;
  const isConnected = hasConfig;

  const handleSave = async () => {
    setLoading(true);
    try {
      // Validate required fields
      if (!formData.supabase_url || !formData.supabase_service_key) {
        toast({
          title: "Validation Error",
          description: "Please fill in all required fields: URL and Service Key",
          variant: "destructive"
        });
        return;
      }

      // Test the connection before saving
      console.log('Testing Supabase connection...');
      const testResult = await supabase.functions.invoke('test-external-supabase', {
        body: {
          clientId,
          supabaseConfig: {
            url: formData.supabase_url,
            serviceKey: formData.supabase_service_key
          }
        }
      });

      if (testResult.error) {
        console.error('Test connection failed:', testResult.error);
        // The fn now returns 400/502 on failure; supabase-js wraps that as a
        // FunctionsHttpError with the Response on .context. Pull the specific
        // {success:false,error} body it still sends so the toast stays helpful.
        let description = testResult.error.message || "Failed to test connection";
        try {
          const ctx = (testResult.error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) description = body.error;
          }
        } catch { /* keep the generic message */ }
        toast({
          title: "Connection Test Failed",
          description,
          variant: "destructive"
        });
        return;
      }

      if (testResult.data?.error) {
        console.error('Connection error:', testResult.data.error);
        toast({
          title: "Configuration Error",
          description: testResult.data.error,
          variant: "destructive"
        });
        return;
      }

      // Connection test passed, now save the configuration
      const { error } = await supabase
        .from('clients')
        .update({
          supabase_service_key: formData.supabase_service_key || null,
          supabase_url: formData.supabase_url || null
        })
        .eq('id', clientId);

      if (error) throw error;

      toast({
        title: "Configuration saved",
        description: "Supabase configuration has been verified and saved successfully"
      });

      setIsEditing(false);
      onUpdate();
    } catch (error: any) {
      console.error('Error saving config:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save configuration",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      supabase_service_key: config.supabase_service_key || '',
      supabase_url: config.supabase_url || ''
    });
    setIsEditing(false);
  };

  const handleResetConnection = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({
          supabase_service_key: null,
          supabase_url: null
        })
        .eq('id', clientId);

      if (error) throw error;

      toast({
        title: "Connection reset",
        description: "Supabase connection has been reset successfully"
      });

      setFormData({
        supabase_service_key: '',
        supabase_url: ''
      });
      onUpdate();
    } catch (error: any) {
      console.error('Error resetting connection:', error);
      toast({
        title: "Error",
        description: "Failed to reset connection",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="material-surface">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Supabase Configuration</CardTitle>
              <CardDescription>
                Connect to your Supabase instance where chat history is stored
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <Badge variant="outline" className="text-green-600 border-green-600">
                Connected
              </Badge>
            )}
            {!isConnected && !isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Configure
              </Button>
            )}
            {isConnected && !isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetConnection}
                disabled={loading}
                className="flex items-center gap-2"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                Reset Connection
              </Button>
            )}
            {isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="supabase_url" className="text-sm font-medium">
                Supabase URL
              </Label>
              <Input
                id="supabase_url"
                value={formData.supabase_url}
                onChange={(e) => setFormData({ ...formData, supabase_url: e.target.value })}
                placeholder="https://your-project.supabase.co"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Your Supabase project URL
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supabase_service_key" className="text-sm font-medium">
                Supabase Service API Key
              </Label>
              <div className="relative">
                <Input
                  id="supabase_service_key"
                  type={showServiceKey ? "text" : "password"}
                  value={formData.supabase_service_key}
                  onChange={(e) => setFormData({ ...formData, supabase_service_key: e.target.value })}
                  placeholder="Enter your Supabase service role key"
                  className="font-mono text-sm pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowServiceKey(!showServiceKey)}
                >
                  {showServiceKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used for server-side operations to access your chat history data
              </p>
            </div>


            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={loading}
                className="flex items-center gap-2"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Configuration
              </Button>
              <Button
                onClick={handleCancel}
                variant="outline"
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {isConnected ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Supabase URL:</span>
                    <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded truncate max-w-xs">
                      {config.supabase_url}
                    </code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Service Key:</span>
                    <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      ●●●●●●●●●●●●●●●●
                    </code>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-green-700 font-medium">
                    Connection established and persistent
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
                  <Database className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Configure your Supabase connection to analyze chat history data.
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Once connected, your credentials will be securely stored and persist across sessions.
                </p>
                <Button 
                  onClick={() => setIsEditing(true)}
                  size="sm"
                  className="modern-button-primary"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configure Supabase
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};