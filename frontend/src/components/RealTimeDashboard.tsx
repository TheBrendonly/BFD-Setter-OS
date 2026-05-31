import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { 
  Play, 
  Pause, 
  RefreshCw, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Calendar,
  Users,
  Plus,
  Trash2
} from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import AppHeader from '@/components/AppHeader';

interface Campaign {
  id: string;
  campaign_name: string;
  status: string;
  total_leads: number;
  processed_leads: number;
  created_at: string;
  webhook_url: string;
  reactivation_notes: string;
}

interface Lead {
  id: string;
  campaign_id: string;
  lead_data: any;
  status: string;
  scheduled_for: string | null;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface ExecutionLog {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  status: string;
  webhook_response: string | null;
  error_details: string | null;
  retry_count: number;
  execution_time: string;
}

const RealTimeDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch campaigns
  const fetchCampaigns = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      toast({
        title: "Error",
        description: "Failed to fetch campaigns",
        variant: "destructive"
      });
    }
  };

  // Fetch leads for a campaign
  const fetchLeads = async (campaignId: string) => {
    try {
      const { data, error } = await supabase
        .from('campaign_leads')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
    }
  };

  // Fetch execution logs for a campaign
  const fetchExecutionLogs = async (campaignId: string) => {
    try {
      const { data, error } = await supabase
        .from('execution_logs')
        .select('*')
        .eq('campaign_id', campaignId)
      .order('execution_time', { ascending: false })
        .limit(50);

      if (error) throw error;
      setExecutionLogs(data || []);
    } catch (error) {
      console.error('Error fetching execution logs:', error);
    }
  };

  // Real-time subscriptions
  useEffect(() => {
    if (!user) return;

    fetchCampaigns();

    // Subscribe to campaigns changes
    const campaignsSubscription = supabase
      .channel('campaigns_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaigns',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Campaign change:', payload);
          fetchCampaigns();
        }
      )
      .subscribe();

    // Subscribe to leads changes
    const leadsSubscription = supabase
      .channel('leads_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads'
        },
        (payload) => {
          console.log('Lead change:', payload);
          if (selectedCampaign) {
            fetchLeads(selectedCampaign.id);
          }
        }
      )
      .subscribe();

    // Subscribe to execution logs changes
    const logsSubscription = supabase
      .channel('execution_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'execution_logs'
        },
        (payload) => {
          console.log('Execution log change:', payload);
          if (selectedCampaign) {
            fetchExecutionLogs(selectedCampaign.id);
          }
        }
      )
      .subscribe();

    setLoading(false);

    return () => {
      supabase.removeChannel(campaignsSubscription);
      supabase.removeChannel(leadsSubscription);
      supabase.removeChannel(logsSubscription);
    };
  }, [user]);

  // Load data when campaign is selected
  useEffect(() => {
    if (selectedCampaign) {
      fetchLeads(selectedCampaign.id);
      fetchExecutionLogs(selectedCampaign.id);
    }
  }, [selectedCampaign]);

  // Pause/Resume campaign
  const toggleCampaignStatus = async (campaign: Campaign) => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    
    try {
      const { error } = await supabase
        .from('campaigns')
        .update({ status: newStatus })
        .eq('id', campaign.id);

      if (error) throw error;

      toast({
        title: `Campaign ${newStatus}`,
        description: `Campaign "${campaign.campaign_name}" has been ${newStatus}`,
      });
    } catch (error) {
      console.error('Error updating campaign status:', error);
      toast({
        title: "Error",
        description: "Failed to update campaign status",
        variant: "destructive"
      });
    }
  };

  // Delete campaign and all associated data
  const deleteCampaign = async (campaign: Campaign) => {
    try {
      const { error } = await supabase.rpc('delete_campaign_with_data', {
        campaign_id_param: campaign.id
      });

      if (error) throw error;

      toast({
        title: "Campaign deleted",
        description: `Campaign "${campaign.campaign_name}" and all associated data has been deleted`,
      });

      // Clear selected campaign if it was deleted
      if (selectedCampaign?.id === campaign.id) {
        setSelectedCampaign(null);
      }

      // Refresh campaigns list
      fetchCampaigns();
    } catch (error) {
      console.error('Error deleting campaign:', error);
      toast({
        title: "Error",
        description: "Failed to delete campaign",
        variant: "destructive"
      });
    }
  };

  const getStatusBadge = (status: string, campaign?: Campaign) => {
    // Check if campaign is done (all leads processed)
    const isDone = campaign && campaign.total_leads > 0 && campaign.processed_leads >= campaign.total_leads;
    const displayStatus = isDone ? 'done' : status;
    
    const variants: Record<string, { variant: any; icon: React.ReactNode }> = {
      active: { variant: "default", icon: <Play className="w-3 h-3" /> },
      paused: { variant: "secondary", icon: <Pause className="w-3 h-3" /> },
      completed: { variant: "outline", icon: <CheckCircle className="w-3 h-3" /> },
      done: { variant: "outline", icon: <CheckCircle className="w-3 h-3" /> },
      pending: { variant: "outline", icon: <Clock className="w-3 h-3" /> },
      processing: { variant: "default", icon: <RefreshCw className="w-3 h-3" /> },
      failed: { variant: "destructive", icon: <XCircle className="w-3 h-3" /> }
    };

    const config = variants[displayStatus] || variants.pending;
    
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {displayStatus === 'done' ? 'Done' : displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)}
      </Badge>
    );
  };

  const getLeadDisplayName = (leadData: any) => {
    return leadData?.email || leadData?.name || leadData?.first_name || 'Unknown Lead';
  };

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <AppHeader
        title="Campaign Dashboard"
        subtitle="Monitor your reactivation campaigns in real-time"
      />

      {/* Campaigns Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((campaign) => {
          const progressPercentage = campaign.total_leads > 0 
            ? (campaign.processed_leads / campaign.total_leads) * 100 
            : 0;
          
          return (
            <Card 
              key={campaign.id} 
              className={`cursor-pointer transition-all hover:shadow-lg ${
                selectedCampaign?.id === campaign.id ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => setSelectedCampaign(campaign)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{campaign.campaign_name}</CardTitle>
                  {getStatusBadge(campaign.status, campaign)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{campaign.processed_leads}/{campaign.total_leads}</span>
                  </div>
                  <Progress value={progressPercentage} className="h-2" />
                </div>
                
                <div className="flex items-center justify-between text-sm text-on-surface-variant">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(campaign.created_at).toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {campaign.total_leads}
                  </span>
                </div>

                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCampaignStatus(campaign);
                    }}
                    className="flex-1"
                  >
                    {campaign.status === 'active' ? (
                      <>
                        <Pause className="w-3 h-3 mr-1" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 mr-1" />
                        Resume
                      </>
                    )}
                  </Button>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{campaign.campaign_name}"? 
                          This will permanently delete the campaign and all associated leads and execution logs. 
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteCampaign(campaign)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Campaign
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Selected Campaign Details */}
      {selectedCampaign && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Leads Table */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {leads.map((lead) => (
                  <div 
                    key={lead.id} 
                    className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{getLeadDisplayName(lead.lead_data)}</div>
                      {lead.scheduled_for && (
                        <div className="text-xs text-on-surface-variant">
                          Scheduled: {new Date(lead.scheduled_for).toLocaleString()}
                        </div>
                      )}
                      {lead.error_message && (
                        <div className="text-xs text-destructive">{lead.error_message}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(lead.status)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Execution Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Execution Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {executionLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-muted rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{log.status || 'Unknown'}</span>
                      <span className="text-xs text-on-surface-variant">
                        {new Date(log.execution_time).toLocaleTimeString()}
                      </span>
                    </div>
                    {log.webhook_response && (
                      <div className="text-xs text-on-surface-variant max-h-20 overflow-y-auto">
                        {log.webhook_response}
                      </div>
                    )}
                    {log.error_details && (
                      <div className="text-xs text-destructive mt-1">{log.error_details}</div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {campaigns.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No campaigns found</p>
            <p className="text-muted-foreground">Create your first campaign to get started</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RealTimeDashboard;