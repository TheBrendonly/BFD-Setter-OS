import React, { useState, useEffect } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusTag } from '@/components/StatusTag';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2, Link } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { usePageHeader } from '@/contexts/PageHeaderContext';

const WEBINAR_WEBHOOK_URL = 'https://n8n-1prompt.99players.com/webhook/update_webinar_details';

const WebinarSetupLinks = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  usePageHeader({
    title: 'Webinar',
    breadcrumbs: [
      { label: 'Webinar' },
      { label: 'Credentials' },
    ],
  });
  
  const [loading, setLoading] = useState(true);
  const [savingWebinarUrl, setSavingWebinarUrl] = useState(false);
  const [savingReplayUrl, setSavingReplayUrl] = useState(false);
  const [clientSupabaseUrl, setClientSupabaseUrl] = useState<string | null>(null);
  const [clientSupabaseAnonKey, setClientSupabaseAnonKey] = useState<string | null>(null);
  
  const [webinarUrl, setWebinarUrl] = useState('');
  const [originalWebinarUrl, setOriginalWebinarUrl] = useState('');
  const [replayUrl, setReplayUrl] = useState('');
  const [originalReplayUrl, setOriginalReplayUrl] = useState('');

  useEffect(() => {
    if (clientId) {
      fetchWebinarData();
    }
  }, [clientId, user]);

  const fetchWebinarData = async () => {
    if (!clientId || !user) {
      setLoading(false);
      return;
    }
    
    try {
      // Fetch client's Supabase URL and API key
      const { data: clientData } = await supabase
        .from('clients')
        .select('supabase_url, supabase_service_key')
        .eq('id', clientId)
        .single();

      if (clientData) {
        setClientSupabaseUrl(clientData.supabase_url);
        setClientSupabaseAnonKey(clientData.supabase_service_key);
      }

      // Fetch from our webinar_setup table
      const { data: webinarData, error } = await supabase
        .from('webinar_setup')
        .select('webinar_url, replay_url')
        .eq('client_id', clientId)
        .maybeSingle();

      if (!error && webinarData) {
        setWebinarUrl(webinarData.webinar_url || '');
        setOriginalWebinarUrl(webinarData.webinar_url || '');
        setReplayUrl(webinarData.replay_url || '');
        setOriginalReplayUrl(webinarData.replay_url || '');
      }
    } catch (error: any) {
      console.log('Error fetching webinar data:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const validateUrl = (url: string): boolean => {
    if (!url.trim()) return false;
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'https:' || urlObj.protocol === 'http:';
    } catch {
      return false;
    }
  };

  const handleSaveWebinarUrl = async () => {
    if (!validateUrl(webinarUrl)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid Webinar URL",
        variant: "destructive",
      });
      return;
    }

    setSavingWebinarUrl(true);
    try {
      const { error: dbError } = await supabase
        .from('webinar_setup')
        .upsert({ 
          client_id: clientId, 
          webinar_url: webinarUrl,
          replay_url: originalReplayUrl || null
        }, { onConflict: 'client_id' });

      if (dbError) throw dbError;

      const webhookPayload = {
        client_id: clientId,
        field_updated: 'webinar_url',
        webinar_url: webinarUrl,
        replay_url: originalReplayUrl || null,
        supabase_url: clientSupabaseUrl,
        supabase_api_key: clientSupabaseAnonKey,
      };

      try {
        await supabase.functions.invoke('notify-webhook', {
          body: { url: WEBINAR_WEBHOOK_URL, payload: webhookPayload },
        });
      } catch (webhookError) {
        console.error('Webhook error:', webhookError);
      }

      setOriginalWebinarUrl(webinarUrl);
      toast({ title: "Success", description: "Webinar URL saved successfully" });
    } catch (error: any) {
      console.error('Error saving field:', error);
      toast({ title: "Error", description: "Failed to save Webinar URL", variant: "destructive" });
    } finally {
      setSavingWebinarUrl(false);
    }
  };

  const handleSaveReplayUrl = async () => {
    if (replayUrl && !validateUrl(replayUrl)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid Replay URL",
        variant: "destructive",
      });
      return;
    }

    setSavingReplayUrl(true);
    try {
      const { error: dbError } = await supabase
        .from('webinar_setup')
        .upsert({ 
          client_id: clientId, 
          webinar_url: originalWebinarUrl,
          replay_url: replayUrl || null
        }, { onConflict: 'client_id' });

      if (dbError) throw dbError;

      const webhookPayload = {
        client_id: clientId,
        field_updated: 'replay_url',
        webinar_url: originalWebinarUrl,
        replay_url: replayUrl || null,
        supabase_url: clientSupabaseUrl,
        supabase_api_key: clientSupabaseAnonKey,
      };

      try {
        await supabase.functions.invoke('notify-webhook', {
          body: { url: WEBINAR_WEBHOOK_URL, payload: webhookPayload },
        });
      } catch (webhookError) {
        console.error('Webhook error:', webhookError);
      }

      setOriginalReplayUrl(replayUrl);
      toast({ title: "Success", description: "Replay URL saved successfully" });
    } catch (error: any) {
      console.error('Error saving field:', error);
      toast({ title: "Error", description: "Failed to save Replay URL", variant: "destructive" });
    } finally {
      setSavingReplayUrl(false);
    }
  };

  if (loading) {
    return <RetroLoader />;
  }

  const isWebinarConfigured = Boolean(originalWebinarUrl?.trim());
  const isReplayConfigured = Boolean(originalReplayUrl?.trim());

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Sticky Header */}
      <div className="flex-shrink-0 sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b">
        <div className="container mx-auto max-w-7xl px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Link className="w-6 h-6 text-primary" />
            Your Details
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your webinar and replay URLs
          </p>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto max-w-7xl px-4 py-6">
          <Card className="material-surface">
            <CardContent className="space-y-6 pt-6">
              {/* Webinar URL */}
              <div className={cn(
                "space-y-2 rounded-lg p-4 border-2",
                isWebinarConfigured 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="webinarUrl" className="text-sm font-medium">Webinar URL</Label>
                  {isWebinarConfigured && (
                    <StatusTag variant="positive">Configured</StatusTag>
                  )}
                </div>
                <Input 
                  id="webinarUrl"
                  type="text"
                  autoComplete="off"
                  placeholder={isWebinarConfigured ? '' : 'https://zoom.us/webinar/...'}
                  value={webinarUrl}
                  onChange={(e) => setWebinarUrl(e.target.value)}
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveWebinarUrl}
                    disabled={savingWebinarUrl}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingWebinarUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Replay URL */}
              <div className={cn(
                "space-y-2 rounded-lg p-4 border-2",
                isReplayConfigured 
                  ? "border-green-500 bg-green-500/10" 
                  : "border-muted"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="replayUrl" className="text-sm font-medium">Replay URL</Label>
                  {isReplayConfigured && (
                    <StatusTag variant="positive">Configured</StatusTag>
                  )}
                </div>
                <Input 
                  id="replayUrl"
                  type="text"
                  autoComplete="off"
                  placeholder={isReplayConfigured ? '' : 'https://your-replay-url.com/...'}
                  value={replayUrl}
                  onChange={(e) => setReplayUrl(e.target.value)}
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveReplayUrl}
                    disabled={savingReplayUrl}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingReplayUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default WebinarSetupLinks;
