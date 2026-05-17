import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

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

interface Campaign {
  id: string;
  campaign_name: string;
  reactivation_notes: string | null;
  webhook_url: string;
  status: string;
  total_leads: number;
  processed_leads: number;
  created_at: string;
  updated_at: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  timezone: string;
  batch_size: number;
  batch_interval_minutes: number;
  lead_delay_seconds: number;
}

// Improved schedule checker with proper overnight support
function isWithinSchedule(campaign: Campaign): boolean {
  const now = new Date();
  
  console.log(`\n=== SCHEDULE CHECK FOR CAMPAIGN ${campaign.id} ===`);
  console.log(`Campaign: ${campaign.campaign_name}`);
  console.log(`Current UTC time: ${now.toISOString()}`);
  
  // Use proper timezone conversion with Intl.DateTimeFormat
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: campaign.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const zonedDate = new Date(
    `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}T${parts.find(p => p.type === 'hour')?.value}:${parts.find(p => p.type === 'minute')?.value}:${parts.find(p => p.type === 'second')?.value}`
  );
  
  console.log(`Current time in ${campaign.timezone}: ${zonedDate.toISOString().slice(0, 19)}`);
  
  // Get day of week (0 = Sunday, 1 = Monday, etc.)
  const dayOfWeek = zonedDate.getDay();
  console.log(`Current day of week: ${dayOfWeek} (0=Sun, 1=Mon...)`);
  
  // Parse start and end times
  const [startHour, startMinute] = campaign.start_time.split(':').map(Number);
  const [endHour, endMinute] = campaign.end_time.split(':').map(Number);
  
  console.log(`Start time: ${campaign.start_time}`);
  console.log(`End time: ${campaign.end_time}`);
  console.log(`Days: ${campaign.days_of_week.join(',')}`);
  
  // Get current hour and minute in campaign timezone
  const currentHour = zonedDate.getHours();
  const currentMinute = zonedDate.getMinutes();
  const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
  
  console.log(`Current time: ${currentTime}`);
  
  // Check if it's an overnight schedule
  const isOvernightSchedule = endHour < startHour || (endHour === startHour && endMinute < startMinute);
  console.log(`Is overnight schedule: ${isOvernightSchedule}`);
  
  let withinTimeWindow = false;
  let dayInSchedule = false;
  
  if (isOvernightSchedule) {
    // For overnight schedules, check if current time is after start OR before end
    withinTimeWindow = (currentHour > startHour || (currentHour === startHour && currentMinute >= startMinute)) ||
                      (currentHour < endHour || (currentHour === endHour && currentMinute <= endMinute));
    
    // For overnight schedules, check both current day and previous day
    const previousDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    dayInSchedule = campaign.days_of_week.includes(dayOfWeek) || campaign.days_of_week.includes(previousDay);
    
    console.log(`Overnight schedule: time after start OR before end = ${withinTimeWindow}`);
    console.log(`Day in schedule (current ${dayOfWeek} or previous ${previousDay}): ${dayInSchedule}`);
  } else {
    // Normal schedule: current time must be between start and end
    withinTimeWindow = (currentHour > startHour || (currentHour === startHour && currentMinute >= startMinute)) &&
                      (currentHour < endHour || (currentHour === endHour && currentMinute <= endMinute));
    
    dayInSchedule = campaign.days_of_week.includes(dayOfWeek);
    
    console.log(`Normal schedule: ${currentTime} >= ${campaign.start_time} AND ${currentTime} <= ${campaign.end_time} AND day ${dayOfWeek} in schedule = ${withinTimeWindow && dayInSchedule}`);
  }
  
  const result = withinTimeWindow && dayInSchedule;
  console.log(`Final result: ${result ? '✅ WITHIN SCHEDULE' : '❌ OUTSIDE SCHEDULE'}`);
  console.log(`=== END SCHEDULE CHECK ===\n`);
  
  return result;
}

// Lead processing with webhook call
async function processLeadWebhook(lead: Lead, campaign: Campaign, clientSupabaseConfig: any): Promise<{ success: boolean; leadId: string; error?: string }> {
  console.log(`🔄 Processing lead ${lead.id} for campaign ${campaign.id}`);
  
  try {
    // Capture exact execution time for precise timing tracking
    const exactExecutionTime = new Date().toISOString();
    
    // Update lead status to processing with exact timestamp
    await supabase
      .from('campaign_leads')
      .update({ 
        status: 'processing',
        processed_at: exactExecutionTime // Set exact time when processing starts
      })
      .eq('id', lead.id);

    console.log(`📤 Calling webhook: ${campaign.webhook_url}`);
    
    // Create webhook payload with Supabase credentials
    const webhookPayload = {
      campaignId: campaign.id,
      campaignName: campaign.campaign_name,
      leadId: lead.id,
      leadData: lead.lead_data,
      reactivationNotes: campaign.reactivation_notes,
      scheduledFor: lead.scheduled_for,
      processedAt: exactExecutionTime, // Use exact execution time
      supabase_url: clientSupabaseConfig?.supabase_url || null,
      supabase_service_key: clientSupabaseConfig?.supabase_service_key || null,
      supabase_table_name: clientSupabaseConfig?.supabase_table_name || null,
      database_reactivation_inbound_webhook_url: clientSupabaseConfig?.database_reactivation_inbound_webhook_url || null
    };

    console.log(`📋 Webhook payload:`, JSON.stringify(webhookPayload, null, 2));

    // Send webhook with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(campaign.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Campaign-Executor/2.0'
      },
      body: JSON.stringify(webhookPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    console.log(`📥 Webhook response status: ${response.status}`);
    console.log(`📥 Webhook response:`, responseText);

    if (response.ok) {
      // Success - update lead status but keep the exact processing time
      await supabase
        .from('campaign_leads')
        .update({ 
          status: 'completed'
          // Keep the processed_at timestamp from when processing started
        })
        .eq('id', lead.id);

      // Log successful execution
      await supabase
        .from('execution_logs')
        .insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          status: 'success',
          webhook_response: responseText,
          execution_time: new Date().toISOString()
        });

      console.log(`✅ Lead ${lead.id} completed successfully`);
      return { success: true, leadId: lead.id };
    } else {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Lead ${lead.id} failed:`, errorMessage);

    // Update lead with error but keep the exact processing time from when it started
    await supabase
      .from('campaign_leads')
      .update({ 
        status: 'failed', 
        error_message: errorMessage
        // Keep the processed_at timestamp from when processing started
      })
      .eq('id', lead.id);

    // Log failed execution
    await supabase
      .from('execution_logs')
      .insert({
        campaign_id: campaign.id,
        lead_id: lead.id,
        status: 'error',
        error_details: errorMessage,
        execution_time: new Date().toISOString()
      });

    return { success: false, leadId: lead.id, error: errorMessage };
  }
}

async function checkAndProcessCampaigns() {
  try {
    console.log('\n🚀 STARTING CAMPAIGN EXECUTION CHECK');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    // Get active campaigns
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('status', 'active');

    if (campaignsError) {
      console.error('❌ Error fetching campaigns:', campaignsError);
      return;
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('📭 No active campaigns found');
      return;
    }

    console.log(`📊 Found ${campaigns.length} active campaigns`);

    // Process campaigns sequentially to avoid batch conflicts
    for (const campaign of campaigns) {
      try {
        await processCampaign(campaign);
      } catch (error) {
        console.error(`❌ Error processing campaign ${campaign.id}:`, error);
        // Continue with other campaigns even if one fails
      }
    }
    
    console.log('✅ Campaign execution check completed\n');
    
  } catch (error) {
    console.error('💥 Error in checkAndProcessCampaigns:', error);
  }
}

async function processCampaign(campaign: Campaign) {
  console.log(`\n🔍 Processing campaign: ${campaign.campaign_name} (${campaign.id})`);
  
  // Fetch client Supabase configuration for this campaign
  const { data: campaignWithClient } = await supabase
    .from('campaigns')
    .select('client_id, clients(supabase_url, supabase_service_key, supabase_table_name, database_reactivation_inbound_webhook_url)')
    .eq('id', campaign.id)
    .single();
  
  const clientSupabaseConfig = campaignWithClient?.clients || {};
  console.log(`📋 Client Supabase config loaded:`, JSON.stringify(clientSupabaseConfig, null, 2));
  
  // Clean up stuck leads first
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stuckLeads } = await supabase
    .from('campaign_leads')
    .update({ status: 'pending' })
    .eq('campaign_id', campaign.id)
    .in('status', ['locked_for_processing', 'batch_processing', 'processing'])
    .lt('processed_at', fiveMinutesAgo)
    .select('id');

  if (stuckLeads?.length) {
    console.log(`🧹 Reset ${stuckLeads.length} stuck leads`);
  }
  
  // Check if within schedule
  if (!isWithinSchedule(campaign)) {
    console.log(`⏰ Campaign outside schedule hours`);
    return;
  }

  // Check if enough time has passed since last batch
  if (campaign.batch_interval_minutes > 0) {
    const { data: lastBatch } = await supabase
      .from('execution_logs')
      .select('execution_time')
      .eq('campaign_id', campaign.id)
      .eq('status', 'BATCH_COMPLETED')
      .order('execution_time', { ascending: false })
      .limit(1);

    if (lastBatch && lastBatch.length > 0) {
      const lastBatchTime = new Date(lastBatch[0].execution_time);
      const now = new Date();
      const timeSinceLastBatch = now.getTime() - lastBatchTime.getTime();
      const requiredInterval = campaign.batch_interval_minutes * 60 * 1000;
      
      if (timeSinceLastBatch < requiredInterval) {
        const remainingTime = Math.ceil((requiredInterval - timeSinceLastBatch) / 1000);
        console.log(`⏱️ Batch interval not met. Need to wait ${remainingTime} more seconds`);
        return;
      }
    }
  }

  // Get leads that are due now (within 1 minute tolerance)
  const now = new Date();
  const oneMinuteFromNow = new Date(now.getTime() + 60000);
  
  const { data: dueLeads } = await supabase
    .from('campaign_leads')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .lte('scheduled_for', oneMinuteFromNow.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(campaign.batch_size || 10);

  if (!dueLeads?.length) {
    console.log(`📭 No leads due for processing`);
    return;
  }

  console.log(`🎯 Processing ${dueLeads.length} due leads`);
  
  // Mark leads as processing
  await supabase
    .from('campaign_leads')
    .update({ 
      status: 'processing',
      processed_at: now.toISOString()
    })
    .in('id', dueLeads.map(lead => lead.id));

  // Log batch start
  const batchId = crypto.randomUUID();
  await supabase
    .from('execution_logs')
    .insert({
      campaign_id: campaign.id,
      status: 'BATCH_STARTED',
      webhook_response: JSON.stringify({
        batch_id: batchId,
        batch_size: dueLeads.length,
        start_time: now.toISOString()
      })
    });

  // Process leads with delays
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < dueLeads.length; i++) {
    const lead = dueLeads[i];
    console.log(`📧 Processing lead ${i + 1}/${dueLeads.length}: ${lead.id}`);
    
    try {
      const result = await processLeadWebhook(lead, campaign, clientSupabaseConfig);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (error) {
      console.error(`❌ Lead processing failed:`, error);
      failureCount++;
      
      await supabase
        .from('campaign_leads')
        .update({ 
          status: 'failed', 
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', lead.id);
    }
    
    // Delay between leads (except last)
    if (i < dueLeads.length - 1 && campaign.lead_delay_seconds > 0) {
      await new Promise(resolve => setTimeout(resolve, campaign.lead_delay_seconds * 1000));
    }
  }

  // Log batch completion
  await supabase
    .from('execution_logs')
    .insert({
      campaign_id: campaign.id,
      status: 'BATCH_COMPLETED',
      webhook_response: JSON.stringify({
        batch_id: batchId,
        leads_processed: dueLeads.length,
        success_count: successCount,
        failure_count: failureCount,
        end_time: new Date().toISOString()
      })
    });

  console.log(`📊 Batch completed: ${successCount} succeeded, ${failureCount} failed`);
}

Deno.serve(async (req) => {
  console.log('\n🔥 CAMPAIGN EXECUTOR STARTED');
  console.log(`Request method: ${req.method}`);
  console.log(`Request URL: ${req.url}`);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    
    if (url.pathname === '/process') {
      console.log('📋 Manual trigger for processing campaigns');
      await checkAndProcessCampaigns();
      return new Response(
        JSON.stringify({ message: 'Campaign processing completed' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // Default cron execution
    await checkAndProcessCampaigns();
    
    return new Response(
      JSON.stringify({ 
        message: 'Campaign executor completed',
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
    
  } catch (error: any) {
    console.error('💥 Error in campaign executor:', error);
    
    return new Response(
      JSON.stringify({ 
        error: (error as any)?.message,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});