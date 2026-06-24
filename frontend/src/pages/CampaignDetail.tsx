import React, { useEffect, useState } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusTag } from '@/components/StatusTag';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Database, Zap, Play, Calendar, Users, Clock, Settings, Globe, Timer, Layers, Pause, Download, AlertCircle, FileText, Filter, ExternalLink, Webhook } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import LeadRow from '@/components/LeadRow';
import SimpleBatchTimer from '@/components/SimpleBatchTimer';


import SubmitReportDialog from '@/components/SubmitReportDialog';
import { usePagination } from '@/hooks/usePagination';
import { formatLeadTime } from '@/utils/timeUtils';

interface Lead {
  id: string;
  campaign_id: string;
  lead_data: any;
  status: string;
  processed_at: string | null;
  error_message: string | null;
  scheduled_for: string | null;
}

interface Campaign {
  id: string;
  campaign_name: string;
  status: string;
  total_leads: number;
  processed_leads: number;
  created_at: string;
  updated_at: string;
  reactivation_notes: string;
  webhook_url: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  timezone: string;
  batch_size: number;
  batch_interval_minutes: number;
  lead_delay_seconds: number;
  client_id: string;
}

const CampaignDetail = () => {
  const {
    campaignId
  } = useParams<{
    campaignId: string;
  }>();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [clientName, setClientName] = useState<string>('');
  const [nextBatchETA, setNextBatchETA] = useState<string>('');
  const [dueLeadsCount, setDueLeadsCount] = useState<number>(0);
  const [submitReportDialog, setSubmitReportDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientWebhookUrl, setClientWebhookUrl] = useState<string | null>(null);

  // Extract clientId from URL
  const { clientId } = useParams<{ clientId: string }>();

  usePageHeader({
    title: 'DB Reactivation',
    breadcrumbs: [
      { label: 'DB Reactivation', onClick: () => navigate(`/client/${clientId}/campaigns`) },
      { label: campaign?.campaign_name || 'Campaign Details' },
    ],
  });
  // Filter leads based on status
  const filteredLeads = React.useMemo(() => {
    if (statusFilter === 'all') {
      return leads;
    }
    return leads.filter(lead => lead.status === statusFilter);
  }, [leads, statusFilter]);

  // Pagination hook - use filtered leads
  const {
    currentPage,
    totalPages,
    paginatedData: paginatedLeads,
    goToPage,
    nextPage,
    previousPage,
    canGoNext,
    canGoPrevious
  } = usePagination({
    data: filteredLeads,
    itemsPerPage
  });

  useEffect(() => {
    if (campaignId) {
      fetchCampaignData();

      // Set up real-time subscription for leads updates
      const leadsChannel = supabase.channel(`leads-${campaignId}`).on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leads',
        filter: `campaign_id=eq.${campaignId}`
      }, payload => {
        console.log('Lead updated via real-time:', payload);
        // Update leads state based on the change
        if (payload.eventType === 'UPDATE') {
          setLeads(prevLeads => prevLeads.map(lead => lead.id === payload.new.id ? {
            ...lead,
            ...payload.new
          } : lead));
        } else if (payload.eventType === 'INSERT') {
          setLeads(prevLeads => [...prevLeads, payload.new as Lead]);
        } else if (payload.eventType === 'DELETE') {
          setLeads(prevLeads => prevLeads.filter(lead => lead.id !== payload.old.id));
        }
      }).subscribe();

      // Set up real-time subscription for campaign updates
      const campaignChannel = supabase.channel(`campaign-${campaignId}`).on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'campaigns',
        filter: `id=eq.${campaignId}`
      }, payload => {
        console.log('Campaign updated via real-time:', payload);
        setCampaign(prevCampaign => prevCampaign ? {
          ...prevCampaign,
          ...payload.new
        } : null);
      }).subscribe();
      return () => {
        supabase.removeChannel(leadsChannel);
        supabase.removeChannel(campaignChannel);
      };
    }
  }, [campaignId]);

  const fetchCampaignData = async () => {
    try {
      // Fetch campaign details
      const {
        data: campaignData,
        error: campaignError
      } = await supabase.from('campaigns').select('*').eq('id', campaignId).single();
      if (campaignError) throw campaignError;
      setCampaign(campaignData);

      if (campaignData.client_id) {
        const {
          data: clientData,
          error: clientError
        } = await (supabase
          .from('clients_public')
          .select('name, campaign_webhook_url' as any)
          .eq('id', campaignData.client_id)
          .maybeSingle() as any);
        if (clientError) throw clientError;
        setClientName(clientData?.name || '');
        setClientWebhookUrl(clientData?.campaign_webhook_url || null);
      }

      // Fetch leads for this campaign using secure function
      const {
        data: leadsData,
        error: leadsError
      } = await supabase.rpc('get_secure_leads', {
        campaign_id_filter: campaignId
      });
      if (leadsError) throw leadsError;
      setLeads(leadsData || []);

      // Fetch next batch ETA and due leads count
      await fetchNextBatchInfo();
    } catch (error) {
      console.error('Error fetching campaign data:', error);
      toast({
        title: "Error loading campaign",
        description: "Please try refreshing the page",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchNextBatchInfo = async () => {
    if (!campaignId) return;
    try {
      // Get latest BATCH_COMPLETED log to find next batch time
      const {
        data: lastCompletedBatch
      } = await supabase.from('execution_logs').select('webhook_response').eq('campaign_id', campaignId).eq('status', 'BATCH_COMPLETED').order('execution_time', {
        ascending: false
      }).limit(1).single();
      if (lastCompletedBatch?.webhook_response) {
        const batchInfo = JSON.parse(lastCompletedBatch.webhook_response);
        if (batchInfo.next_batch_time) {
          const nextTime = new Date(batchInfo.next_batch_time);
          const now = new Date();
          if (nextTime > now) {
            const minutesUntil = Math.round((nextTime.getTime() - now.getTime()) / (1000 * 60));
            setNextBatchETA(minutesUntil > 0 ? `${minutesUntil} minutes` : 'Starting soon');
          } else {
            setNextBatchETA('Ready to start');
          }
          setDueLeadsCount(batchInfo.due_leads_remaining || 0);
        }
      }

      // Count current due leads
      const {
        count: currentDueLeads
      } = await supabase.from('campaign_leads').select('*', {
        count: 'exact',
        head: true
      }).eq('campaign_id', campaignId).eq('status', 'pending').lte('scheduled_for', new Date().toISOString());
      setDueLeadsCount(currentDueLeads || 0);
    } catch (error) {
      console.error('Error fetching next batch info:', error);
    }
  };

  const handleLeadUpdate = async () => {
    // Update campaign processed leads count after manual execution
    try {
      const {
        data: stats
      } = await supabase.from('campaign_leads').select('status').eq('campaign_id', campaignId);
      if (stats && campaign) {
        const processedCount = stats.filter(s => s.status === 'completed' || s.status === 'failed').length;

        // Update campaign processed count
        await supabase.from('campaigns').update({
          processed_leads: processedCount,
          updated_at: new Date().toISOString()
        }).eq('id', campaignId);

        // Update local campaign state
        setCampaign(prev => prev ? {
          ...prev,
          processed_leads: processedCount
        } : null);
      }
    } catch (error) {
      console.error('Error updating campaign progress:', error);
    }

    // Refresh the data
    fetchCampaignData();
  };

  const handlePauseCampaign = async () => {
    if (!campaign) return;
    try {
      const newStatus = campaign.status === 'paused' ? 'active' : 'paused';
      const {
        error
      } = await supabase.from('campaigns').update({
        status: newStatus
      }).eq('id', campaignId);
      if (error) throw error;
      setCampaign(prev => prev ? {
        ...prev,
        status: newStatus
      } : null);
      toast({
        title: `Campaign ${newStatus === 'paused' ? 'paused' : 'resumed'}`,
        description: `Campaign has been ${newStatus === 'paused' ? 'paused' : 'resumed'} successfully.`
      });
    } catch (error) {
      console.error('Error updating campaign status:', error);
      toast({
        title: "Error updating campaign",
        description: "Please try again",
        variant: "destructive"
      });
    }
  };

  const downloadAllLeadsCSV = () => {
    if (leads.length === 0) return;

    // Get all unique keys from all leads
    const allKeys = new Set<string>();
    leads.forEach(lead => {
      Object.keys(lead.lead_data).forEach(key => allKeys.add(key));
    });
    const keys = Array.from(allKeys);
    const header = ['Lead ID', 'Status', 'Scheduled For', 'Processed At', ...keys].join(',');
    const csvRows = leads.map(lead => {
      const basicInfo = [lead.id, lead.status, lead.scheduled_for || '', lead.processed_at || ''];
      const leadDataValues = keys.map(key => {
        const value = lead.lead_data[key];
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value || '';
      });
      return [...basicInfo, ...leadDataValues].join(',');
    });
    const csvContent = [header, ...csvRows].join('\n');
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;'
    });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${campaign?.campaign_name || 'campaign'}_leads.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  if (loading) {
    return <RetroLoader />;
  }

  if (!campaign) {
    return <div className="min-h-screen bg-background flex items-center justify-center pb-12">
        <div className="text-center">
          <Database className="w-16 h-16 text-on-surface-variant mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-on-surface mb-2">Campaign not found</h2>
          <Button onClick={() => navigate(`/client/${campaign?.client_id || ''}/database-reactivation`)} className="material-button-primary">
            Back to Dashboard
          </Button>
        </div>
      </div>;
  }

  const pendingLeads = leads.filter(lead => lead.status === 'pending').length;
  const completedLeads = leads.filter(lead => lead.status === 'completed').length;
  const failedLeads = leads.filter(lead => lead.status === 'failed').length;

  // Calculate completion percentage based on actual lead statuses (more accurate)
  const actualProcessedLeads = completedLeads + failedLeads;
  const completionPercentage = campaign && leads.length > 0 ? Math.round(actualProcessedLeads / leads.length * 100) : campaign && campaign.total_leads > 0 ? Math.round(campaign.processed_leads / campaign.total_leads * 100) : 0;

  return <div className="container mx-auto max-w-7xl pb-6 space-y-6">

      {/* Main Content */}
      <div className="space-y-6">
        {/* Campaign Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          <Card className="material-surface">
            <CardContent className="p-3 sm:p-6 text-center">
              <div className="text-lg sm:text-[24px] font-bold text-primary mb-1 sm:mb-2">{leads.length || campaign?.total_leads || 0}</div>
              <div className="text-xs sm:text-sm text-on-surface-variant flex items-center justify-center">
                <Users className="w-3 sm:w-4 h-3 sm:h-4 mr-1" />
                <span className="hidden sm:inline">Total Leads</span>
                <span className="sm:hidden">Total</span>
              </div>
            </CardContent>
          </Card>
          <Card className="material-surface">
            <CardContent className="p-3 sm:p-6 text-center">
              <div className="text-lg sm:text-2xl font-bold text-yellow-500 mb-1 sm:mb-2">{pendingLeads}</div>
              <div className="text-xs sm:text-sm text-on-surface-variant flex items-center justify-center">
                <Calendar className="w-3 sm:w-4 h-3 sm:h-4 mr-1" />
                Pending
              </div>
            </CardContent>
          </Card>
          <Card className="material-surface">
            <CardContent className="p-3 sm:p-6 text-center">
              <div className="text-lg sm:text-2xl font-bold text-green-500 mb-1 sm:mb-2">{completedLeads}</div>
              <div className="text-xs sm:text-sm text-on-surface-variant">Completed</div>
            </CardContent>
          </Card>
          <Card className="material-surface">
            <CardContent className="p-3 sm:p-6 text-center">
              <div className="text-lg sm:text-2xl font-bold text-destructive mb-1 sm:mb-2">{failedLeads}</div>
              <div className="text-xs sm:text-sm text-on-surface-variant">Failed</div>
            </CardContent>
          </Card>
        </div>

        {/* Campaign Configuration Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
          {/* Schedule Configuration */}
          <Card className="material-surface">
            <CardHeader className="pb-3 sm:pb-6">
              <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Calendar className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                Schedule Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4 pt-0">
              <div className="space-y-2 sm:space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-2 sm:space-y-0">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Active Days</span>
                  <div className="flex gap-1 flex-wrap">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => {
                      // Convert to our system: Mon=1, Tue=2, ..., Sat=6, Sun=7  
                      const dayValue = index === 6 ? 7 : index + 1;
                      return <span key={day} className={`px-1 sm:px-2 py-1 text-xs rounded ${campaign.days_of_week?.includes(dayValue) ? 'bg-primary text-primary-foreground' : 'bg-surface text-on-surface-variant'}`}>
                          {day}
                        </span>;
                    })}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-1 sm:space-y-0">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Time Window</span>
                  <span className="text-xs sm:text-sm text-on-surface flex items-center gap-1">
                    <Clock className="w-3 sm:w-4 h-3 sm:h-4" />
                    {campaign.start_time} - {campaign.end_time}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-1 sm:space-y-0">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Timezone</span>
                  <span className="text-xs sm:text-sm text-on-surface flex items-center gap-1">
                    <Globe className="w-3 sm:w-4 h-3 sm:h-4" />
                    <span className="truncate">{campaign.timezone.replace('_', ' ')}</span>
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-1 sm:space-y-0">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Campaign Created</span>
                  <span className="text-xs sm:text-sm text-on-surface">
                    {formatLeadTime(campaign.created_at)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Batch Processing Settings */}
          <Card className="material-surface">
            <CardHeader className="pb-3 sm:pb-6">
              <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Settings className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                Batch Processing Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4 pt-0">
              <div className="space-y-2 sm:space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Batch Size</span>
                  <span className="text-xs sm:text-sm font-semibold text-on-surface flex items-center gap-1">
                    <Layers className="w-3 sm:w-4 h-3 sm:h-4" />
                    <span className="hidden sm:inline">{campaign.batch_size} leads per batch</span>
                    <span className="sm:hidden">{campaign.batch_size}/batch</span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Batch Interval</span>
                  <span className="text-xs sm:text-sm font-semibold text-on-surface flex items-center gap-1">
                    <Timer className="w-3 sm:w-4 h-3 sm:h-4" />
                    {campaign.batch_interval_minutes} min
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Lead Delay</span>
                  <span className="text-xs sm:text-sm font-semibold text-on-surface flex items-center gap-1">
                    <Clock className="w-3 sm:w-4 h-3 sm:h-4" />
                    {campaign.lead_delay_seconds}s
                  </span>
                </div>
                 <div className="flex justify-between items-center">
                   <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Processing Rate</span>
                   <span className="text-xs sm:text-sm text-on-surface">
                     ~{(campaign.batch_size / (campaign.batch_interval_minutes || 1)).toFixed(1)} leads/min
                   </span>
                 </div>
                 {campaign.status === 'active' && nextBatchETA && <div className="flex justify-between items-center border-t border-outline pt-2 mt-2">
                     <span className="text-xs sm:text-sm font-medium text-on-surface-variant flex items-center gap-1">
                       <AlertCircle className="w-3 sm:w-4 h-3 sm:h-4" />
                       Next Batch ETA
                     </span>
                     <span className="text-xs sm:text-sm font-semibold text-primary">
                       {nextBatchETA} ({dueLeadsCount} due)
                     </span>
                   </div>}
              </div>
            </CardContent>
          </Card>
          {/* Webhook Overview (managed in APIs & Integrations) */}
          <Card className="material-surface">
            <CardHeader className="pb-3 sm:pb-6">
              <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Webhook className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                Campaign Webhook
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4 pt-0">
              {clientWebhookUrl ? (
                <div className="space-y-2">
                  <div className="text-xs sm:text-sm break-all text-on-surface-variant">{clientWebhookUrl}</div>
                  <div className="flex gap-2">
                    <StatusTag variant="positive">Configured</StatusTag>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/client/${campaign.client_id}/api-management`)}
                      className="inline-flex items-center gap-1"
                    >
                      Manage in APIs & Integrations <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm text-on-surface-variant">No webhook configured</span>
                  <Button
                    size="sm"
                    onClick={() => navigate(`/client/${campaign.client_id}/api-management`)}
                    className="inline-flex items-center gap-1"
                  >
                    Configure Now <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Progress and Status */}
        <Card className="material-surface">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Zap className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                Campaign Progress & Status
              </CardTitle>
              <div className="flex items-center gap-2">
                <StatusTag variant={campaign.status === 'completed' ? 'positive' : campaign.status === 'active' ? 'positive' : campaign.status === 'paused' ? 'neutral' : 'negative'}>
                  {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                </StatusTag>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Overall Progress</span>
                <span className="text-on-surface font-medium">{completionPercentage}% ({actualProcessedLeads}/{leads.length || campaign?.total_leads || 0})</span>
              </div>
              <div className="w-full bg-surface-variant rounded-full h-3">
                <div className="bg-primary h-3 rounded-full transition-all duration-300" style={{
                  width: `${completionPercentage}%`
                }} />
              </div>
              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-500">{completedLeads}</div>
                  <div className="text-xs text-on-surface-variant">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-yellow-500">{pendingLeads}</div>
                  <div className="text-xs text-on-surface-variant">Pending</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-destructive">{failedLeads}</div>
                  <div className="text-xs text-on-surface-variant">Failed</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Enhanced Real-time Batch Tracking */}
        <SimpleBatchTimer campaignId={campaign.id} campaignStatus={campaign.status} />

        {/* Campaign Notes & Webhook */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
          <Card className="material-surface">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Campaign Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                {campaign.reactivation_notes || 'No notes provided for this campaign.'}
              </p>
            </CardContent>
          </Card>

          <Card className="material-surface">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Webhook Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <span className="text-xs sm:text-sm font-medium text-on-surface-variant">Endpoint URL</span>
                <div className="py-2 sm:py-3 bg-surface rounded-lg">
                  <code className="text-xs text-on-surface break-all">
                    {campaign.webhook_url}
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Leads Table */}
        <Card className="border border-border shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <Users className="w-4 sm:w-5 h-4 sm:h-5 text-primary" />
                  All Leads ({filteredLeads.length} of {leads.length} total)
                </CardTitle>
                <p className="text-muted-foreground text-xs sm:text-sm mt-1">
                  Detailed view of leads in this campaign with execution controls
                </p>
              </div>
              
              {/* Filters and Per Page Selector - Mobile Optimized */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                {/* Status Filter */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
                    <Filter className="w-3 sm:w-4 h-3 sm:h-4" />
                    Filter by status:
                  </span>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ({leads.length})</SelectItem>
                      <SelectItem value="pending">Pending ({pendingLeads})</SelectItem>
                      <SelectItem value="completed">Completed ({completedLeads})</SelectItem>
                      <SelectItem value="failed">Failed ({failedLeads})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Per Page Selector */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-xs sm:text-sm text-muted-foreground">Show:</span>
                  <Select value={itemsPerPage.toString()} onValueChange={value => setItemsPerPage(Number(value))}>
                    <SelectTrigger className="w-full sm:w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs sm:text-sm text-muted-foreground">leads per page</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {filteredLeads.length === 0 ? <div className="text-center py-12">
                  <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {statusFilter === 'all' 
                      ? 'No leads found for this campaign.' 
                      : `No ${statusFilter} leads found.`}
                  </p>
                </div> : <>
                  <div className="divide-y divide-border">
                    {paginatedLeads.map((lead, index) => {
                    // Calculate delay from previous lead based on actual execution order (processed_at)
                    let delayFromPrevious: number | undefined = undefined;
                    if (lead.processed_at && lead.status === 'completed') {
                      // Find the previously executed lead (by processed_at time, not display order)
                      const allProcessedLeads = leads
                        .filter(l => l.processed_at && (l.status === 'completed' || l.status === 'failed'))
                        .sort((a, b) => new Date(a.processed_at!).getTime() - new Date(b.processed_at!).getTime());
                      
                      const currentLeadIndex = allProcessedLeads.findIndex(l => l.id === lead.id);
                      if (currentLeadIndex > 0) {
                        const currentTime = new Date(lead.processed_at).getTime();
                        const previousTime = new Date(allProcessedLeads[currentLeadIndex - 1].processed_at!).getTime();
                        delayFromPrevious = (currentTime - previousTime) / 1000; // Convert to seconds
                      }
                    }
                    return <LeadRow key={lead.id} lead={lead} campaignWebhookUrl={campaign.webhook_url} campaignName={campaign.campaign_name} campaignNotes={campaign.reactivation_notes} onLeadUpdate={handleLeadUpdate} delayFromPrevious={delayFromPrevious} leadNumber={(currentPage - 1) * itemsPerPage + index + 1} />;
                  })}
                  </div>
                  
                  {/* Pagination */}
                  {totalPages > 1 && <div className="border-t p-4">
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious onClick={canGoPrevious ? previousPage : undefined} className={!canGoPrevious ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                          </PaginationItem>
                          
                          {/* Page Numbers */}
                          {Array.from({
                        length: Math.min(5, totalPages)
                      }, (_, i) => {
                        const pageNum = currentPage <= 3 ? i + 1 : currentPage - 2 + i;
                        if (pageNum > totalPages) return null;
                        return <PaginationItem key={pageNum}>
                                <PaginationLink onClick={() => goToPage(pageNum)} isActive={currentPage === pageNum} className="cursor-pointer">
                                  {pageNum}
                                </PaginationLink>
                              </PaginationItem>;
                      })}
                          
                          <PaginationItem>
                            <PaginationNext onClick={canGoNext ? nextPage : undefined} className={!canGoNext ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                      
                      <div className="text-center text-sm text-muted-foreground mt-2">
                        Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredLeads.length)} of {filteredLeads.length} filtered leads ({leads.length} total)
                      </div>
                    </div>}
                </>}
             </div>
           </CardContent>
         </Card>
      </div>
      
      {/* Submit Report Dialog */}
      <SubmitReportDialog
        open={submitReportDialog}
        onOpenChange={setSubmitReportDialog}
        campaignId={campaignId!}
        clientId={campaign.client_id}
      />
    </div>;
};

export default CampaignDetail;
