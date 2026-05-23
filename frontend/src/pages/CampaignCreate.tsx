import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import FileUpload from '@/components/FileUpload';
import CampaignForm from '@/components/CampaignForm';
import ScheduleConfig from '@/components/ScheduleConfig';

import { useToast } from '@/hooks/use-toast';
import { Database, Zap, ArrowLeft, Webhook, CheckCircle, AlertCircle, ExternalLink, Upload, Users } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { parseCsvFile, validateCsvData } from '@/utils/csvParser';
import { addHours, addMinutes, format } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

interface ScheduleData {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  batchSize: number;
  batchIntervalMinutes: number;
  leadDelaySeconds: number;
}

const CampaignCreate = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { clientId: paramClientId } = useParams();
  const clientId = paramClientId || searchParams.get('clientId');
  const { toast } = useToast();

  usePageHeader({
    title: 'DB Reactivation',
    breadcrumbs: [
      { label: 'DB Reactivation', onClick: () => navigate(`/client/${clientId}/campaigns`) },
      { label: 'Create Campaign' },
    ],
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [reactivationNotes, setReactivationNotes] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [clientName, setClientName] = useState<string>('');
  
  // Lead source selection
  const [leadSource, setLeadSource] = useState<'none' | 'csv' | 'contacts'>('none');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [contactLeadData, setContactLeadData] = useState<any[]>([]);
  
  const [scheduleData, setScheduleData] = useState<ScheduleData>({
    daysOfWeek: [2, 3, 4, 5, 6], // Tue-Sat
    startTime: '09:00',
    endTime: '17:00',
    timezone: 'America/New_York',
    batchSize: 10,
    batchIntervalMinutes: 15,
    leadDelaySeconds: 5,
  });

  const [supabaseConfigured, setSupabaseConfigured] = useState(false);

  // Accept contacts passed from Contacts page via navigation state
  useEffect(() => {
    const state = location.state as { contactLeads?: any[] } | null;
    if (state?.contactLeads && state.contactLeads.length > 0) {
      setContactLeadData(state.contactLeads);
      setLeadSource('contacts');
      toast({
        title: "Contacts Loaded",
        description: `${state.contactLeads.length} contacts ready as campaign leads`,
      });
      // Clear state to prevent re-triggering on re-renders
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    const fetchClientData = async () => {
      if (!clientId) return;
      try {
        const { data: client, error } = await (supabase
          .from('clients')
          .select('name, campaign_webhook_url, supabase_url, supabase_service_key' as any)
          .eq('id', clientId)
          .maybeSingle() as any);
        
        if (error) throw error;
        setClientName(client?.name || '');
        setWebhookUrl(client?.campaign_webhook_url || '');
        
        // Check if Supabase is configured (URL and service key only - no table name required)
        const hasSupabaseConfig = !!(
          client?.supabase_url && 
          client?.supabase_service_key
        );
        setSupabaseConfigured(hasSupabaseConfig);
      } catch (error) {
        console.error('Error fetching client:', error);
      }
    };
    
    fetchClientData();
  }, [clientId]);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setContactLeadData([]);
    setSelectedContactIds(new Set());
    console.log('File selected:', file.name, file.size);
    toast({
      title: "File uploaded successfully",
      description: `${file.name} is ready for processing`,
    });
  };

  // Bug 5 — preset filters for the contact picker. Each preset rewrites the
  // server-side query so the row count shown to the user matches what will be
  // enrolled. Filters compose with AND semantics.
  type ContactPreset = 'cold_60d' | 'sequence_complete' | 'no_booking' | 'not_opted_out';
  const [contactPresets, setContactPresets] = useState<Set<ContactPreset>>(new Set());
  const [compositeFilterCapped, setCompositeFilterCapped] = useState(false);
  const togglePreset = (p: ContactPreset) => {
    setContactPresets(prev => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  // Fetch contacts for the contact picker
  const fetchContacts = async () => {
    if (!clientId) return;
    let q = supabase
      .from('leads')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (contactPresets.has('cold_60d')) {
      const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      // Cold = last_inbound_at OR last_message_at is older than 60d (or NULL).
      // Server-side OR via .or() for the joint condition.
      q = q.or(`last_inbound_at.is.null,last_inbound_at.lt.${cutoff}`);
    }
    if (contactPresets.has('not_opted_out')) {
      q = q.or('setter_stopped.is.null,setter_stopped.eq.false');
    }

    const { data, error } = await q;
    if (error) {
      setAllContacts([]);
      return;
    }
    let rows = data ?? [];

    // The remaining two presets require joins; do them client-side after fetch.
    // For sequence_complete: check engagement_executions for kind='new_lead' AND status='completed'.
    // For no_booking: check bookings table NOT EXISTS.
    //
    // Batch 3 code-review fix: cap the IN() arrays at 500 so the composite
    // filter doesn't time out Supabase queries on 10K+ lead clients. The
    // initial server fetch already limits to 1000; the cap is conservative
    // for the join paths. UI flags the cap so operators know to narrow.
    const COMPOSITE_FILTER_CAP = 500;
    setCompositeFilterCapped(false);
    if (contactPresets.has('sequence_complete') || contactPresets.has('no_booking')) {
      if (rows.length > COMPOSITE_FILTER_CAP) {
        setCompositeFilterCapped(true);
      }
      const leadIds = rows.map((r: any) => r.lead_id).filter(Boolean).slice(0, COMPOSITE_FILTER_CAP);
      if (leadIds.length > 0) {
        if (contactPresets.has('sequence_complete')) {
          const { data: execs } = await (supabase
            .from('engagement_executions')
            .select('lead_id')
            .eq('client_id', clientId)
            .eq('status', 'completed')
            .in('lead_id', leadIds) as any);
          const completedSet = new Set((execs as Array<{ lead_id: string }> | null ?? []).map(e => e.lead_id));
          rows = rows.filter((r: any) => completedSet.has(r.lead_id));
        }
        if (contactPresets.has('no_booking')) {
          const survivors = rows.map((r: any) => r.lead_id).slice(0, COMPOSITE_FILTER_CAP);
          if (survivors.length > 0) {
            const { data: bks } = await (supabase
              .from('bookings')
              .select('lead_id')
              .eq('client_id', clientId)
              .in('lead_id', survivors) as any);
            const bookedSet = new Set((bks as Array<{ lead_id: string }> | null ?? []).map(b => b.lead_id));
            rows = rows.filter((r: any) => !bookedSet.has(r.lead_id));
          }
        }
      }
    }

    setAllContacts(rows);
  };

  const handleChooseFromContacts = () => {
    fetchContacts();
    setShowContactPicker(true);
  };

  // Bug 5 — re-fetch contacts whenever the preset set changes while the picker is open
  React.useEffect(() => {
    if (showContactPicker) {
      fetchContacts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactPresets, showContactPicker]);

  // Bug 7 — campaign preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const previewSummary = useMemo(() => {
    try {
      const sourceLeads = contactLeadData.length > 0 ? contactLeadData : [];
      if (sourceLeads.length === 0) {
        return { leadCount: 0, batches: 0, sampleTimes: [] as Date[] };
      }
      const times = calculateScheduledTimes(sourceLeads, scheduleData);
      const sample = times.slice(0, 5);
      const batches = Math.ceil(sourceLeads.length / Math.max(1, scheduleData.batchSize || 1));
      return { leadCount: sourceLeads.length, batches, sampleTimes: sample };
    } catch {
      return { leadCount: 0, batches: 0, sampleTimes: [] as Date[] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactLeadData, scheduleData]);

  const launchClick = () => {
    if (contactLeadData.length === 0 && !selectedFile) {
      handleCampaignSubmit();
      return;
    }
    setShowPreviewModal(true);
  };
  const confirmAndLaunch = () => {
    setShowPreviewModal(false);
    handleCampaignSubmit();
  };

  const toggleContactSelection = (id: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirmContactSelection = () => {
    const selected = allContacts.filter(c => selectedContactIds.has(c.id));
    // Convert contacts to lead data format
    const leadData = selected.map(c => {
      const data: Record<string, string> = { first_name: c.first_name || '', last_name: c.last_name || '', email: c.email || '', phone: c.phone || '', business_name: c.business_name || '', ...((c.custom_fields || {}) as Record<string, string>) };
      return {
        'First Name': data['First Name'] || data['first_name'] || '',
        'Last Name': data['Last Name'] || data['last_name'] || '',
        'Email': data['Email'] || data['email'] || '',
        'Phone': data['Phone'] || data['phone'] || '',
        'Company': data['Company'] || data['company'] || '',
        'Website': data['Website'] || data['website'] || '',
        'Address': data['Address'] || data['address'] || '',
        ...Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`Custom Value ${i + 1}`, data[`Custom Value ${i + 1}`] || ''])
        ),
      };
    });
    setContactLeadData(leadData);
    setSelectedFile(null);
    setShowContactPicker(false);
    setLeadSource('contacts');
    toast({
      title: "Contacts Selected",
      description: `${selected.length} contacts added as campaign leads`,
    });
  };

  const calculateScheduledTimes = (csvData: any[], scheduleData: ScheduleData) => {
    const times: Date[] = [];
    
    // Validate schedule configuration
    if (scheduleData.startTime === scheduleData.endTime) {
      throw new Error('Start time and end time cannot be the same');
    }
    
    // Check for overnight schedule (end time before start time)
    const startHour = parseInt(scheduleData.startTime.split(':')[0]);
    const endHour = parseInt(scheduleData.endTime.split(':')[0]);
    const isOvernightSchedule = endHour < startHour;
    
    // Get current time in campaign timezone
    const now = new Date();
    const currentTimeInTz = toZonedTime(now, scheduleData.timezone);
    
    // Create start and end times for today in campaign timezone
    const todayStr = format(currentTimeInTz, 'yyyy-MM-dd');
    const tomorrowStr = format(addHours(currentTimeInTz, 24), 'yyyy-MM-dd');
    
    const startTimeStr = `${todayStr} ${scheduleData.startTime}:00`;
    let endTimeStr: string;
    
    if (isOvernightSchedule) {
      // End time is next day for overnight schedules
      endTimeStr = `${tomorrowStr} ${scheduleData.endTime}:00`;
    } else {
      // Same day schedule
      endTimeStr = `${todayStr} ${scheduleData.endTime}:00`;
    }
    
    // Parse times in campaign timezone then convert back to UTC
    let currentTime = fromZonedTime(new Date(startTimeStr), scheduleData.timezone);
    const endTimeToday = fromZonedTime(new Date(endTimeStr), scheduleData.timezone);
    
    // If we're past today's end time or not on an active day, start tomorrow
    // Convert JavaScript day (0=Sunday) to our system (7=Sunday)
    const todayDayOfWeek = currentTimeInTz.getDay() === 0 ? 7 : currentTimeInTz.getDay();
    if (now >= endTimeToday || !scheduleData.daysOfWeek.includes(todayDayOfWeek)) {
      // Find next active day
      let nextDay = new Date(currentTime);
      nextDay.setDate(nextDay.getDate() + 1);
      
      while (true) {
        const nextDayInTz = toZonedTime(nextDay, scheduleData.timezone);
        // Convert JavaScript day (0=Sunday) to our system (7=Sunday)
        const nextDayOfWeek = nextDayInTz.getDay() === 0 ? 7 : nextDayInTz.getDay();
        
        if (scheduleData.daysOfWeek.includes(nextDayOfWeek)) {
          // Found next active day, set to start time
          const nextDayStr = format(nextDayInTz, 'yyyy-MM-dd');
          const nextStartTimeStr = `${nextDayStr} ${scheduleData.startTime}:00`;
          currentTime = fromZonedTime(new Date(nextStartTimeStr), scheduleData.timezone);
          break;
        }
        
        nextDay.setDate(nextDay.getDate() + 1);
      }
    } else if (now > currentTime) {
      // If we're within today's window but past start time, start immediately
      currentTime = now;
    }
    
    // Calculate batch scheduling with proper intervals
    let batchStartTime = new Date(currentTime);
    
    for (let i = 0; i < csvData.length; i++) {
      const leadIndexInBatch = i % scheduleData.batchSize;
      const batchNumber = Math.floor(i / scheduleData.batchSize);
      
      // If starting a new batch (except first batch), add batch interval
      if (leadIndexInBatch === 0 && batchNumber > 0) {
        batchStartTime = new Date(batchStartTime.getTime() + (scheduleData.batchIntervalMinutes * 60 * 1000));
      }
      
      // Calculate lead time within the batch (batch start + lead delays)
      const leadTime = new Date(batchStartTime.getTime() + (leadIndexInBatch * scheduleData.leadDelaySeconds * 1000));
      
      // Check if lead time is within active hours and day
      let finalLeadTime = leadTime;
      
      while (true) {
        const leadTimeInTz = toZonedTime(finalLeadTime, scheduleData.timezone);
        const leadDayOfWeek = leadTimeInTz.getDay() === 0 ? 7 : leadTimeInTz.getDay();
        
        // Get day's end time in UTC - handle overnight schedules
        const dayStr = format(leadTimeInTz, 'yyyy-MM-dd');
        let dayEndStr: string;
        let dayEndUTC: Date;
        
        if (isOvernightSchedule) {
          // For overnight schedules, end time is next day
          const nextDayStr = format(addHours(leadTimeInTz, 24), 'yyyy-MM-dd');
          dayEndStr = `${nextDayStr} ${scheduleData.endTime}:00`;
        } else {
          // For same-day schedules, end time is same day
          dayEndStr = `${dayStr} ${scheduleData.endTime}:00`;
        }
        dayEndUTC = fromZonedTime(new Date(dayEndStr), scheduleData.timezone);
        
        // Check if we're within the active time window
        const dayStartStr = `${dayStr} ${scheduleData.startTime}:00`;
        const dayStartUTC = fromZonedTime(new Date(dayStartStr), scheduleData.timezone);
        
        let isWithinActiveHours: boolean;
        if (isOvernightSchedule) {
          // For overnight: from start time today until end time tomorrow
          isWithinActiveHours = finalLeadTime >= dayStartUTC && finalLeadTime < dayEndUTC;
        } else {
          // For same day: from start time to end time same day
          isWithinActiveHours = finalLeadTime >= dayStartUTC && finalLeadTime < dayEndUTC;
        }
        
        // If not on active day or outside active hours, move to next active day start
        if (!scheduleData.daysOfWeek.includes(leadDayOfWeek) || !isWithinActiveHours) {
          let nextDay = new Date(finalLeadTime);
          nextDay.setDate(nextDay.getDate() + 1);
          
          while (true) {
            const nextDayInTz = toZonedTime(nextDay, scheduleData.timezone);
            const nextDayOfWeek = nextDayInTz.getDay() === 0 ? 7 : nextDayInTz.getDay();
            
            if (scheduleData.daysOfWeek.includes(nextDayOfWeek)) {
              const nextDayStr = format(nextDayInTz, 'yyyy-MM-dd');
              const nextStartTimeStr = `${nextDayStr} ${scheduleData.startTime}:00`;
              finalLeadTime = fromZonedTime(new Date(nextStartTimeStr), scheduleData.timezone);
              
              // Update batch start time for subsequent leads in this batch
              if (leadIndexInBatch === 0) {
                batchStartTime = finalLeadTime;
              } else {
                // Recalculate lead time within batch after day shift
                finalLeadTime = new Date(batchStartTime.getTime() + (leadIndexInBatch * scheduleData.leadDelaySeconds * 1000));
              }
              break;
            }
            
            nextDay.setDate(nextDay.getDate() + 1);
          }
        } else {
          // Time is valid, use it
          break;
        }
      }
      
      // Store the scheduled time (already in UTC)
      times.push(new Date(finalLeadTime));
    }
    
    return times;
  };

  const handleCampaignSubmit = async () => {
    const hasLeads = selectedFile || contactLeadData.length > 0;
    if (!hasLeads || !user) {
      toast({
        title: "No leads selected",
        description: "Please upload a CSV file or choose from your contact list",
        variant: "destructive",
      });
      return;
    }

    if (!campaignName.trim() || !reactivationNotes.trim()) {
      toast({
        title: "Missing information",
        description: "Please fill in campaign name and reactivation notes",
        variant: "destructive",
      });
      return;
    }

    if (!webhookUrl.trim()) {
      toast({
        title: "Webhook Not Configured",
        description: "Please configure the campaign webhook in APIs & Integrations before creating a campaign",
        variant: "destructive",
      });
      return;
    }

    if (!supabaseConfigured) {
      toast({
        title: "Supabase Not Configured",
        description: "Please configure Supabase credentials in APIs & Integrations before creating a campaign",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    console.log('Submitting campaign with schedule:', { campaignName, reactivationNotes, webhookUrl, scheduleData });

    try {
      let csvData: any[];

      if (contactLeadData.length > 0) {
        // Using contacts as lead source
        csvData = contactLeadData;
        console.log('Using contact list:', csvData.length, 'leads');
      } else if (selectedFile) {
        // Parse CSV file
        console.log('Starting CSV file parsing...');
        const rawCsvData = await parseCsvFile(selectedFile);
        console.log(`CSV parsed: ${rawCsvData.length} rows found`);
        
        // Validate CSV data against template
        const validation = validateCsvData(rawCsvData);
        
        if (!validation.isValid) {
          console.error('CSV validation failed:', validation.errors);
          const errorMessage = validation.errors.length === 1 
            ? validation.errors[0]
            : `Multiple issues found:\n• ${validation.errors.join('\n• ')}`;
          
          toast({ title: "CSV Upload Failed", description: errorMessage, variant: "destructive" });
          return;
        }
        csvData = rawCsvData;
      } else {
        toast({ title: "No leads", description: "Please select a lead source", variant: "destructive" });
        return;
      }
      
      console.log('Leads ready:', csvData.length, 'rows');

      // Show success message with lead count
      toast({
        title: "CSV Validated Successfully",
        description: `✅ ${csvData.length.toLocaleString()} leads ready for campaign launch`,
      });

      // Create campaign record first with "pending" status
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          campaign_name: campaignName,
          reactivation_notes: reactivationNotes,
          webhook_url: webhookUrl,
          status: 'pending', // Start as pending until leads are inserted
          total_leads: csvData.length,
          processed_leads: 0,
          client_id: clientId, // Use client_id instead of user_id
          user_id: user.id, // Set user_id explicitly for RLS
          days_of_week: scheduleData.daysOfWeek,
          start_time: scheduleData.startTime,
          end_time: scheduleData.endTime,
          timezone: scheduleData.timezone,
          batch_size: scheduleData.batchSize,
          batch_interval_minutes: scheduleData.batchIntervalMinutes,
          lead_delay_seconds: scheduleData.leadDelaySeconds
        })
        .select()
        .single();

      if (campaignError) throw campaignError;

      console.log('Campaign created, now inserting leads...');
      
      // Show processing message
      toast({
        title: "Uploading leads...",
        description: `Processing ${csvData.length} leads. Please wait...`,
      });

      // Process leads using new bulk insert with proper parameters
      try {
        console.log(`=== STARTING LEAD PROCESSING ===`);
        console.log(`Campaign ID: ${campaign.id}`);
        console.log(`Total leads to process: ${csvData.length}`);
        console.log(`Sample lead data:`, csvData[0]);
        
        // Use bulk insert edge function with proper parameters
        console.log('Using bulk insert edge function for fast, reliable uploads...');
        
        const { data: bulkResult, error: bulkError } = await supabase.functions.invoke('bulk-insert-leads', {
          body: {
            campaignId: campaign.id,
            leads: csvData,
            batchSize: scheduleData.batchSize,
            batchIntervalMinutes: scheduleData.batchIntervalMinutes,
            leadDelaySeconds: scheduleData.leadDelaySeconds,
            startTime: scheduleData.startTime,
            endTime: scheduleData.endTime,
            timezone: scheduleData.timezone,
            daysOfWeek: scheduleData.daysOfWeek
          }
        });
        
        if (bulkError) {
          console.error('Bulk insert failed:', bulkError);
          throw new Error(`Failed to insert leads: ${bulkError.message}`);
        }
        
        console.log('✅ Bulk insert completed:', bulkResult);
        
        // Show success message and redirect immediately after bulk insert
        toast({
          title: "Campaign Launched Successfully!",
          description: `${bulkResult.actualInserted} leads inserted and campaign is starting`,
        });
        
        console.log('✅ Redirecting to campaign page:', campaign.id);
        navigate(`/client/${clientId}/campaigns/${campaign.id}`);
        
        // Update campaign status to active in background (don't wait)
        console.log('Updating campaign status to active in background...');
        supabase
          .from('campaigns')
          .update({ 
            status: 'active',
            total_leads: bulkResult.actualInserted
          })
          .eq('id', campaign.id)
          .then(({ error: updateError }) => {
            if (updateError) {
              console.error('Failed to update campaign status:', updateError);
            } else {
              console.log('✅ Campaign status updated to active');
            }
          });
        
        // Trigger campaign executor in background (don't wait)
        console.log('Triggering campaign executor in background...');
        supabase.functions.invoke('campaign-executor')
          .then(() => {
            console.log('✅ Campaign executor triggered successfully');
          })
          .catch((executorError) => {
            console.warn('Failed to trigger executor:', executorError);
          });
        
        
      } catch (error) {
        console.error('=== LEAD PROCESSING FAILED ===');
        console.error('Error details:', error);
        
        // Update campaign status to failed
        await supabase
          .from('campaigns')
          .update({ 
            status: 'failed',
            reactivation_notes: `${reactivationNotes}\n\n❌ Processing Error: ${error.message || 'Lead insertion failed'}`
          })
          .eq('id', campaign.id);
        
        throw error; // Re-throw to be caught by outer try-catch
      }
      
    } catch (error) {
      console.error('Error launching campaign:', error);
      
      // Provide specific error messages based on error type
      let errorMessage = "An unexpected error occurred. Please try again.";
      let errorTitle = "Campaign Launch Failed";
      
      // Check for Supabase error object structure
      if (error && typeof error === 'object' && 'message' in error) {
        const errorObj = error as any;
        
        if (errorObj.message?.includes('validation failed')) {
          errorTitle = "CSV Validation Error"; 
          errorMessage = errorObj.message.replace('CSV validation failed: ', '');
        } else if (errorObj.message?.includes('network') || errorObj.message?.includes('fetch')) {
          errorTitle = "Connection Error";
          errorMessage = "❌ Network connection failed. Please check your internet connection and try again.";
        } else if (errorObj.message?.includes('timeout')) {
          errorTitle = "Upload Timeout";
          errorMessage = "❌ Upload took too long. Please try with a smaller file or check your connection.";
        } else if (errorObj.message?.includes('duplicate')) {
          errorTitle = "Duplicate Data Error";
          errorMessage = "❌ Some leads in your CSV already exist. Please remove duplicates and try again.";
        } else if (errorObj.message?.includes('permission') || errorObj.message?.includes('unauthorized')) {
          errorTitle = "Permission Error";
          errorMessage = "❌ You don't have permission to create campaigns for this client. Please contact support.";
        } else {
          errorMessage = `❌ ${errorObj.message || 'Database error occurred. Please try again.'}`;
        }
      } else if (error instanceof Error) {
        errorMessage = `❌ ${error.message}`;
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl pb-6 space-y-6">
      {/* Back button */}
      <Button variant="outline" onClick={() => navigate(`/client/${clientId}/campaigns`)}>
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back
      </Button>
            
            {/* Lead Source Selection */}
            <Card className="material-surface">
              <CardHeader>
                <CardTitle className="text-lg">Select Lead Source</CardTitle>
                <CardDescription>Choose how to add leads to this campaign</CardDescription>
              </CardHeader>
              <CardContent>
                {leadSource === 'none' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card
                      className="cursor-pointer border-2 border-border hover:border-primary transition-colors p-6 text-center"
                      onClick={() => setLeadSource('csv')}
                    >
                      <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                      <h3 className="font-semibold text-foreground">Upload a CSV</h3>
                      <p className="text-sm text-muted-foreground mt-1">Import leads from a CSV file</p>
                    </Card>
                    <Card
                      className="cursor-pointer border-2 border-border hover:border-primary transition-colors p-6 text-center"
                      onClick={handleChooseFromContacts}
                    >
                      <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                      <h3 className="font-semibold text-foreground">Choose from Contact List</h3>
                      <p className="text-sm text-muted-foreground mt-1">Select from your existing contacts</p>
                    </Card>
                  </div>
                ) : leadSource === 'csv' ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <Badge variant="secondary">CSV Upload</Badge>
                      <Button variant="ghost" size="sm" onClick={() => { setLeadSource('none'); setSelectedFile(null); }}>Change Source</Button>
                    </div>
                    <FileUpload onFileSelect={handleFileSelect} selectedFile={selectedFile} />
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <Badge variant="secondary">Contact List — {contactLeadData.length} leads selected</Badge>
                      <Button variant="ghost" size="sm" onClick={() => { setLeadSource('none'); setContactLeadData([]); setSelectedContactIds(new Set()); }}>Change Source</Button>
                    </div>
                    <p className="text-sm text-muted-foreground">{contactLeadData.length} contacts will be used as campaign leads.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Campaign Configuration Section */}
            <Card className="material-surface">
              <CardHeader>
                <CardTitle className="text-lg">Campaign Configuration</CardTitle>
                <CardDescription>Set up your campaign details and messaging</CardDescription>
              </CardHeader>
              <CardContent>
                <CampaignForm
                  campaignName={campaignName}
                  setCampaignName={setCampaignName}
                  reactivationNotes={reactivationNotes}
                  setReactivationNotes={setReactivationNotes}
                  isLoading={isLoading}
                />
                
                {/* Webhook URL Field */}
                <div className="mt-6 space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Webhook className="w-4 h-4 text-muted-foreground" />
                    Campaign Webhook URL
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={e => setWebhookUrl(e.target.value)}
                    placeholder="https://your-webhook-url.com/endpoint"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    The webhook URL where campaign lead data will be sent. Must be HTTPS.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Schedule Configuration Section */}
            <Card className="material-surface">
              <CardHeader>
                <CardTitle className="text-lg">Schedule & Timing</CardTitle>
                <CardDescription>Configure when and how your campaign runs</CardDescription>
              </CardHeader>
              <CardContent>
                <ScheduleConfig onScheduleChange={setScheduleData} />
              </CardContent>
            </Card>

            {/* Status Information */}
            {(selectedFile || contactLeadData.length > 0) && (
              <Card className="material-surface animate-fade-in mb-8">
                <CardHeader>
                  <CardTitle className="text-lg">Ready to Process</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Source:</span>
                      <p className="font-medium text-foreground">
                        {selectedFile ? selectedFile.name : `${contactLeadData.length} contacts`}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Schedule:</span>
                      <p className="font-medium text-foreground">
                        {scheduleData.daysOfWeek.length} days, {scheduleData.startTime}-{scheduleData.endTime}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Batch Size:</span>
                      <p className="font-medium text-foreground">{scheduleData.batchSize} leads</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Launch Campaign Button */}
            <div className="flex justify-center mt-12">
              <Button
                onClick={launchClick}
                disabled={(!selectedFile && contactLeadData.length === 0) || !campaignName.trim() || !reactivationNotes.trim() || isLoading}
                size="lg"
                className="min-w-[280px]"
              >
                {isLoading ? (
                  <>
                    <Database className="w-5 h-5 mr-2 animate-pulse" />
                    Launching Campaign...
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 mr-2" />
                    Launch Reactivation Campaign
                  </>
                )}
              </Button>
            </div>

      {/* Bug 7 — Campaign Preview Modal */}
      <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Preview Campaign</DialogTitle>
            <DialogDescription style={{ fontSize: '13px' }}>
              Confirm scheduling before launching. First {previewSummary.sampleTimes.length} of {previewSummary.leadCount} leads shown.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="border rounded p-2 bg-card">
                <div className="text-xs text-muted-foreground">Leads</div>
                <div className="text-lg font-semibold">{previewSummary.leadCount}</div>
              </div>
              <div className="border rounded p-2 bg-card">
                <div className="text-xs text-muted-foreground">Batches</div>
                <div className="text-lg font-semibold">{previewSummary.batches}</div>
              </div>
              <div className="border rounded p-2 bg-card">
                <div className="text-xs text-muted-foreground">Batch size</div>
                <div className="text-lg font-semibold">{scheduleData.batchSize}</div>
              </div>
              <div className="border rounded p-2 bg-card">
                <div className="text-xs text-muted-foreground">Window</div>
                <div className="text-sm">{scheduleData.startTime}–{scheduleData.endTime} {scheduleData.timezone}</div>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Sample scheduled times</div>
              <ul className="text-xs font-mono space-y-0.5 bg-card border rounded p-2">
                {previewSummary.sampleTimes.length === 0 ? (
                  <li className="text-muted-foreground">(no times computed — check schedule config)</li>
                ) : previewSummary.sampleTimes.map((t, i) => (
                  <li key={i}>{i + 1}. {t.toLocaleString('en-AU', { timeZone: scheduleData.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="px-6 pb-6 flex gap-2 shrink-0">
            <Button variant="outline" className="flex-1" onClick={() => setShowPreviewModal(false)}>
              CANCEL
            </Button>
            <Button className="flex-1" onClick={confirmAndLaunch} disabled={isLoading || previewSummary.leadCount === 0}>
              {isLoading ? 'LAUNCHING...' : `CONFIRM & LAUNCH ${previewSummary.leadCount}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact Picker Dialog */}
      <Dialog open={showContactPicker} onOpenChange={setShowContactPicker}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Select Contacts</DialogTitle>
            <DialogDescription>Choose contacts to use as campaign leads. {selectedContactIds.size} selected.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-6">
            {/* Bug 5 — preset filter chips */}
            <div className="mb-3 flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground mr-1">Presets:</span>
              {([
                { id: 'cold_60d', label: '60+ days since last contact' },
                { id: 'sequence_complete', label: 'Sequence complete only' },
                { id: 'no_booking', label: 'No booking yet' },
                { id: 'not_opted_out', label: 'Not opted out' },
              ] as Array<{ id: ContactPreset; label: string }>).map(p => {
                const active = contactPresets.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePreset(p.id)}
                    className={`text-xs px-2.5 py-1 rounded border ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:bg-accent'}`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <span className="text-xs text-muted-foreground ml-auto">
                {allContacts.length} match{allContacts.length === 1 ? '' : 'es'}
                {allContacts.length > 0 && selectedContactIds.size === 0 && (
                  <button
                    type="button"
                    className="ml-2 underline hover:text-foreground"
                    onClick={() => setSelectedContactIds(new Set(allContacts.map(c => c.id)))}
                  >
                    select all
                  </button>
                )}
              </span>
            </div>
            {selectedContactIds.size > 100 && (
              <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                ⚠ {selectedContactIds.size} leads selected. Reactivation campaigns should usually start at ≤ 100 leads on the first run so cost + delivery anomalies surface early.
              </div>
            )}
            {compositeFilterCapped && (
              <div className="mb-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                ℹ Showing first 500 leads only — sequence/booking filters cap their input array for performance. Narrow with "60+ days" or "Not opted out" before applying sequence/booking filters for an accurate count.
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allContacts.length > 0 && selectedContactIds.size === allContacts.length}
                      onCheckedChange={() => {
                        if (selectedContactIds.size === allContacts.length) {
                          setSelectedContactIds(new Set());
                        } else {
                          setSelectedContactIds(new Set(allContacts.map(c => c.id)));
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Company</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allContacts.map(contact => {
                  const d: Record<string, string> = { first_name: contact.first_name || '', last_name: contact.last_name || '', email: contact.email || '', phone: contact.phone || '' };
                  return (
                    <TableRow key={contact.id} className="cursor-pointer" onClick={() => toggleContactSelection(contact.id)}>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedContactIds.has(contact.id)}
                          onCheckedChange={() => toggleContactSelection(contact.id)}
                        />
                      </TableCell>
                      <TableCell className="text-sm">{d['First Name'] || d['first_name'] || ''} {d['Last Name'] || d['last_name'] || ''}</TableCell>
                      <TableCell className="text-sm">{d['Email'] || d['email'] || ''}</TableCell>
                      <TableCell className="text-sm">{d['Phone'] || d['phone'] || ''}</TableCell>
                      <TableCell className="text-sm">{d['Company'] || d['company'] || ''}</TableCell>
                    </TableRow>
                  );
                })}
                {allContacts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No contacts found. Import contacts first.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setShowContactPicker(false)}>Cancel</Button>
            <Button onClick={confirmContactSelection} disabled={selectedContactIds.size === 0}>
              Use {selectedContactIds.size} Contacts
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CampaignCreate;
