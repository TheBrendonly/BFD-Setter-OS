import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isWithinBusinessHours, getNextValidTime } from "../_shared/business-hours.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface LeadData {
  [key: string]: string;
}

interface BulkInsertRequest {
  campaignId: string;
  leads: LeadData[];
  batchSize: number;
  batchIntervalMinutes: number;
  leadDelaySeconds: number;
  startTime: string;
  endTime: string;
  timezone: string;
  daysOfWeek: number[];
}

// Business-hours helpers extracted to ../_shared/business-hours.ts
// (so other edge functions can reuse the same convention).

Deno.serve(async (req) => {
  console.log('Bulk insert leads function called');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Parsing request body...');
    const requestData: BulkInsertRequest = await req.json();
    
    // Fetch campaign settings from database to ensure authoritative scheduling
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', requestData.campaignId)
      .single();
    
    if (campaignError || !campaign) {
      throw new Error(`Campaign ${requestData.campaignId} not found`);
    }
    
    console.log(`Using campaign settings from DB: ${campaign.start_time}-${campaign.end_time} (${campaign.timezone})`);
    console.log(`Campaign batch settings: size=${campaign.batch_size}, interval=${campaign.batch_interval_minutes}min, delay=${campaign.lead_delay_seconds}s`);
    
    const {
      campaignId,
      leads
    } = requestData;
    
    // Use campaign settings from database (authoritative)
    const batchSize = campaign.batch_size || 10;
    const batchIntervalMinutes = campaign.batch_interval_minutes || 15;
    const leadDelaySeconds = campaign.lead_delay_seconds || 5;
    const startTime = campaign.start_time || '09:00';
    const endTime = campaign.end_time || '17:00';
    const timezone = campaign.timezone || 'America/New_York';
    const daysOfWeek = campaign.days_of_week || [1,2,3,4,5];

    console.log(`Processing bulk insert for campaign: ${campaignId}`);
    console.log(`Lead count: ${leads.length}`);

    if (!campaignId || !leads || leads.length === 0) {
      throw new Error('Invalid request: missing campaignId or leads');
    }

    // Calculate scheduled times for all leads with improved algorithm
    console.log('Calculating scheduled times for', leads.length, 'leads');
    console.log(`Target schedule: ${startTime}-${endTime} on days [${daysOfWeek.join(',')}] (${timezone})`);
    
    const now = new Date();
    const isCurrentlyBusinessHours = isWithinBusinessHours(now, startTime, endTime, daysOfWeek, timezone);
    
    let currentScheduleTime;
    if (isCurrentlyBusinessHours) {
      // If we're in business hours, start immediately for first batch
      console.log('✅ Currently in business hours - first batch will start immediately');
      currentScheduleTime = now;
    } else {
      // If outside business hours, find next valid time
      console.log('⏰ Outside business hours - finding next valid start time');
      currentScheduleTime = getNextValidTime(now, startTime, endTime, daysOfWeek, timezone);
    }
    
    console.log(`Starting lead scheduling from: ${currentScheduleTime.toISOString()}`);
    
    const leadsToInsert = [];
    
    // Process leads in batches with precise timing
    for (let batchIndex = 0; batchIndex < Math.ceil(leads.length / batchSize); batchIndex++) {
      const batchStartIndex = batchIndex * batchSize;
      const batchEndIndex = Math.min(batchStartIndex + batchSize, leads.length);
      const batchLeads = leads.slice(batchStartIndex, batchEndIndex);
      
      // Set the batch time - all leads in this batch get the same scheduled_for time
      const batchTime = new Date(currentScheduleTime);
      
      // Ensure batch time is within business hours
      if (!isWithinBusinessHours(batchTime, startTime, endTime, daysOfWeek, timezone)) {
        currentScheduleTime = getNextValidTime(batchTime, startTime, endTime, daysOfWeek, timezone);
      }
      
      console.log(`📦 Batch ${batchIndex + 1}: ${batchLeads.length} leads scheduled for ${currentScheduleTime.toISOString()}`);
      
      // All leads in this batch get the exact same scheduled_for time
      for (const leadData of batchLeads) {
        leadsToInsert.push({
          campaign_id: campaignId,
          lead_data: leadData,
          status: 'pending',
          scheduled_for: currentScheduleTime.toISOString()
        });
      }
      
      // Move to next batch time (add batch interval)
      if (batchIndex < Math.ceil(leads.length / batchSize) - 1) {
        currentScheduleTime = new Date(currentScheduleTime.getTime() + (batchIntervalMinutes * 60 * 1000));
      }
    }

    console.log('Calculating scheduled times...');
    console.log(`First lead scheduled for: ${leadsToInsert[0].scheduled_for}`);
    console.log(`Last lead scheduled for: ${leadsToInsert[leadsToInsert.length - 1].scheduled_for}`);

    // Insert leads in chunks to avoid timeouts
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < leadsToInsert.length; i += chunkSize) {
      chunks.push(leadsToInsert.slice(i, i + chunkSize));
    }

    console.log(`Inserting ${leadsToInsert.length} leads in chunks of ${chunkSize}...`);

    let totalInserted = 0;
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Inserting chunk ${i + 1}/${chunks.length} (${chunk.length} leads)`);
      
      const { data, error } = await supabase
        .from('campaign_leads')
        .insert(chunk)
        .select('id');

      if (error) {
        console.error(`Error inserting chunk ${i + 1}:`, error);
        throw error;
      }

      totalInserted += data?.length || 0;
      console.log(`Chunk ${i + 1} inserted successfully. Total so far: ${totalInserted}`);
    }

    console.log('All chunks inserted successfully!');

    const result = {
      totalProcessed: leads.length,
      actualInserted: totalInserted,
      duplicatesSkipped: 0,
      firstScheduled: leadsToInsert[0].scheduled_for,
      lastScheduled: leadsToInsert[leadsToInsert.length - 1].scheduled_for
    };

    console.log('Bulk insert completed successfully:', result);

    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('Error in bulk insert:', error);
    
    return new Response(
      JSON.stringify({ 
        error: (error as any)?.message,
        stack: (error as any)?.stack
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});