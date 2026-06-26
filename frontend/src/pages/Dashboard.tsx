import React, { useState, useEffect, useCallback } from 'react';
import { getCached, setCache } from '@/lib/queryCache';
import RetroLoader from '@/components/RetroLoader';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import CampaignCard from '@/components/CampaignCard';
import { Plus, Database } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';

interface Campaign {
  id: string;
  campaign_name: string;
  status: string;
  total_leads: number;
  processed_leads: number;
  created_at: string;
  client_id: string;
  batch_size?: number;
  batch_interval_minutes?: number;
  lead_delay_seconds?: number;
  start_time?: string;
  end_time?: string;
  days_of_week?: number[];
  timezone?: string;
}

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId?: string }>();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState<string>('');
  const [hasSupabaseConfig, setHasSupabaseConfig] = useState(false);

  usePageHeader({
    title: 'DB Reactivation',
    actions: [{
      label: 'NEW CAMPAIGN',
      icon: <Plus className="w-4 h-4" />,
      onClick: () => {
        if (!hasSupabaseConfig) {
          toast({ title: "Supabase Configuration Required", description: "Please configure Supabase settings before creating campaigns", variant: "destructive" });
          return;
        }
        navigate(`/client/${clientId}/campaigns/create`);
      },
      disabled: !hasSupabaseConfig,
    }],
  });

  useEffect(() => {
    if (user && clientId) {
      fetchClientCampaigns();
    }
  }, [user, clientId]);

  useEffect(() => {
    if (user && clientId && campaigns.length > 0) {
      const channel = supabase
        .channel('campaigns-changes')
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'campaigns' }, (payload) => {
          setCampaigns(prev => prev.filter(c => c.id !== payload.old?.id));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'campaigns' }, (payload) => {
          if (payload.new?.client_id === clientId) fetchClientCampaigns();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns' }, (payload) => {
          if (payload.new?.client_id === clientId) {
            setCampaigns(prev => prev.map(c => c.id === payload.new?.id ? { ...c, ...payload.new } : c));
          }
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [user, clientId, campaigns]);

  const fetchClientCampaigns = useCallback(async () => {
    if (!user || !clientId) return;
    const cacheKey = `dashboard_${clientId}`;
    const cached = getCached<{ name: string; hasConfig: boolean; campaigns: Campaign[] }>(cacheKey);
    if (cached) {
      setClientName(cached.name);
      setHasSupabaseConfig(cached.hasConfig);
      setCampaigns(cached.campaigns);
      setLoading(false);
    }
    try {
      const { data: client, error: clientError } = await supabase
        .from('clients_public')
        .select('name, supabase_url, has_supabase_service_key')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;
      setClientName(client.name);
      const hasConfig = !!(client.supabase_url && client.has_supabase_service_key);
      setHasSupabaseConfig(hasConfig);

      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const result = data || [];
      setCampaigns(result);
      setCache(cacheKey, { name: client.name, hasConfig, campaigns: result });
    } catch (error) {
      console.error('Error fetching client campaigns:', error);
      if (!cached) toast({ title: "Error", description: "Failed to fetch campaigns", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, clientId]);

  const handleCampaignDeleted = (deletedCampaignId: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== deletedCampaignId));
  };

  if (loading) {
    return <RetroLoader />;
  }

  if (!clientId) {
    navigate('/clients');
    return null;
  }

  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
  const completedCampaigns = campaigns.filter(c => c.status === 'completed').length;

  return (
    <div className="container mx-auto max-w-7xl pb-6 space-y-6">

      {/* Stats */}
      <div className="stat-row">
        <div className="stat-cell">
          <p className="text-label mb-2">Total Campaigns</p>
          <p className="text-stat text-foreground">{campaigns.length}</p>
        </div>
        <div className="stat-cell">
          <p className="text-label mb-2">Active</p>
          <p className="text-stat text-foreground">{activeCampaigns}</p>
        </div>
        <div className="stat-cell">
          <p className="text-label mb-2">Completed</p>
          <p className="text-stat text-foreground">{completedCampaigns}</p>
        </div>
      </div>

      {/* Campaigns */}
      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16 space-y-4">
            <Database className="w-12 h-12 text-muted-foreground mx-auto" />
            <div className="space-y-1.5">
              <h3 className="text-lg font-medium text-foreground">No campaigns yet</h3>
              <p className="text-sm text-muted-foreground">
                Create your first reactivation campaign for {clientName} to get started.
              </p>
            </div>
            <Button
              onClick={() => navigate(`/client/${clientId}/campaigns/create`)}
              disabled={!hasSupabaseConfig}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Create First Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onDelete={() => handleCampaignDeleted(campaign.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
