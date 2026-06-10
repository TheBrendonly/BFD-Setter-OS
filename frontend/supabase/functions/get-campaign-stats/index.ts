import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("campaign_id");
    const workflowId = url.searchParams.get("workflow_id");
    const dateFrom = url.searchParams.get("date_from");
    const dateTo = url.searchParams.get("date_to");

    if (!campaignId && !workflowId) {
      return new Response(JSON.stringify({ error: "campaign_id or workflow_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve campaign IDs
    let campaignIds: string[] = [];
    if (workflowId) {
      const { data: campaigns } = await supabase
        .from("engagement_campaigns")
        .select("id")
        .eq("workflow_id", workflowId);
      campaignIds = (campaigns || []).map((c: any) => c.id);
      if (campaignIds.length === 0) {
        return new Response(JSON.stringify(emptyStats()), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (campaignId) {
      campaignIds = [campaignId];
    }

    // AUTH: this endpoint was public (verify_jwt=false, service-role) → anyone
    // could read any tenant's enrolment data by guessing a campaign/workflow UUID.
    // Verify the caller's JWT AND that they own the client these campaigns belong to.
    {
      const authHeader = req.headers.get("Authorization");
      const { data: ownerRows } = await supabase
        .from("engagement_campaigns").select("client_id").in("id", campaignIds);
      const ownerClientIds = [...new Set((ownerRows || []).map((r: any) => r.client_id).filter(Boolean))];
      if (ownerClientIds.length !== 1) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        await assertClientAccess(authHeader, ownerClientIds[0] as string);
      } catch (e) {
        if (e instanceof AssertAccessError) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }
    }

    // If date filtering, first get the lead_ids enrolled in that range
    let enrolledLeadIds: string[] | null = null;

    if (dateFrom || dateTo) {
      let enrollQuery = supabase
        .from("campaign_events")
        .select("lead_id")
        .in("campaign_id", campaignIds)
        .eq("event_type", "enrolled");
      if (dateFrom) enrollQuery = enrollQuery.gte("occurred_at", dateFrom);
      if (dateTo) enrollQuery = enrollQuery.lte("occurred_at", dateTo);

      const { data: enrolledData } = await enrollQuery;
      enrolledLeadIds = [...new Set((enrolledData || []).map((e: any) => e.lead_id))];

      if (enrolledLeadIds.length === 0) {
        return new Response(JSON.stringify(emptyStats()), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const addLeadFilter = (query: any) => {
      if (enrolledLeadIds) return query.in("lead_id", enrolledLeadIds);
      return query;
    };

    // Fetch all events + execution data for step attribution
    const [
      enrolledRes, activeRes, completedRes,
      allSentEventsRes, allReplyEventsRes, allEnrolledEventsRes,
      phoneCallSentRes, executionsRes, appointmentBookedRes,
      callHistoryRes,
    ] = await Promise.all([
      // Enrolled count
      enrolledLeadIds
        ? Promise.resolve({ count: enrolledLeadIds.length })
        : supabase.from("campaign_events").select("id", { count: "exact", head: true })
            .in("campaign_id", campaignIds).eq("event_type", "enrolled"),

      // Currently active
      (() => {
        let q = supabase.from("engagement_executions").select("id", { count: "exact", head: true })
          .in("campaign_id", campaignIds).eq("status", "running");
        if (enrolledLeadIds) q = q.in("ghl_contact_id", enrolledLeadIds);
        return q;
      })(),

      // Sequence complete
      (() => {
        let q = supabase.from("engagement_executions").select("id", { count: "exact", head: true })
          .in("campaign_id", campaignIds).eq("status", "completed").eq("stop_reason", "sequence_complete");
        if (enrolledLeadIds) q = q.in("ghl_contact_id", enrolledLeadIds);
        return q;
      })(),

      // All message_sent events
      addLeadFilter(
        supabase.from("campaign_events")
          .select("id, lead_id, channel, execution_id, occurred_at, node_index")
          .in("campaign_id", campaignIds)
          .eq("event_type", "message_sent")
      ),

      // All reply_received events
      addLeadFilter(
        supabase.from("campaign_events")
          .select("id, lead_id, channel, execution_id, occurred_at")
          .in("campaign_id", campaignIds)
          .eq("event_type", "reply_received")
      ),

      // All enrolled events
      addLeadFilter(
        supabase.from("campaign_events")
          .select("id, lead_id, occurred_at")
          .in("campaign_id", campaignIds)
          .eq("event_type", "enrolled")
      ),

      // Phone call sent count
      addLeadFilter(
        supabase.from("campaign_events")
          .select("id", { count: "exact", head: true })
          .in("campaign_id", campaignIds)
          .eq("event_type", "message_sent")
          .eq("channel", "phone_call")
      ),

      // Executions with last_completed_node_index for step attribution
      (() => {
        let q = supabase.from("engagement_executions")
          .select("id, last_completed_node_index")
          .in("campaign_id", campaignIds);
        if (enrolledLeadIds) q = q.in("ghl_contact_id", enrolledLeadIds);
        return q;
      })(),

      // Appointment booked events (full data for charts)
      addLeadFilter(
        supabase.from("campaign_events")
          .select("id, lead_id, occurred_at")
          .in("campaign_id", campaignIds)
          .eq("event_type", "appointment_booked")
      ),

      // Voice call history for this campaign — voicemails, avg duration, call spend
      supabase.from("call_history")
        .select("human_pickup, voicemail_detected, duration_seconds, cost, campaign_id")
        .in("campaign_id", campaignIds),
    ]);

    const allSentEvents = allSentEventsRes.data || [];
    const allReplyEvents = allReplyEventsRes.data || [];
    const allEnrolledEvents = allEnrolledEventsRes.data || [];
    const executions = executionsRes.data || [];
    const callHistoryData = callHistoryRes.data || [];

    // Build execution lookup for step attribution
    const execMap = new Map<string, any>();
    for (const ex of executions) {
      execMap.set(ex.id, ex);
    }

    const totalEnrolled = enrolledLeadIds ? enrolledLeadIds.length : (enrolledRes.count ?? 0);
    const engagedExecutionIds = new Set(allSentEvents.filter((e: any) => e.execution_id).map((e: any) => e.execution_id));
    const totalEngaged = engagedExecutionIds.size;

    // Unique leads per channel
    const smsLeads = new Set<string>();
    const whatsappLeads = new Set<string>();
    const phoneLeads = new Set<string>();
    for (const evt of allSentEvents) {
      if (evt.channel === "sms") smsLeads.add(evt.lead_id);
      else if (evt.channel === "whatsapp") whatsappLeads.add(evt.lead_id);
      else if (evt.channel === "phone_call") phoneLeads.add(evt.lead_id);
    }

    // Per-channel sent counts (total messages)
    const smsSent = allSentEvents.filter((e: any) => e.channel === "sms").length;
    const whatsappSent = allSentEvents.filter((e: any) => e.channel === "whatsapp").length;
    const phoneCallsMade = (phoneCallSentRes as any).count ?? 0;

    // Per-channel reply attribution
    const sentByExecution = new Map<string, any[]>();
    for (const evt of allSentEvents) {
      if (!evt.execution_id) continue;
      if (!sentByExecution.has(evt.execution_id)) sentByExecution.set(evt.execution_id, []);
      sentByExecution.get(evt.execution_id)!.push(evt);
    }

    let smsReplies = 0;
    let whatsappReplies = 0;
    let phonePickups = 0;
    const replyTimestamps: { occurred_at: string; channel: string }[] = [];

    // Replies by engagement step
    const repliesByStep = new Map<number, number>();

    for (const reply of allReplyEvents) {
      // Channel attribution
      let channel = reply.channel;
      if (!channel) {
        const sentForExec = sentByExecution.get(reply.execution_id) || [];
        const sorted = sentForExec
          .filter((s: any) => new Date(s.occurred_at) <= new Date(reply.occurred_at))
          .sort((a: any, b: any) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
        channel = sorted[0]?.channel || "sms";
      }

      if (channel === "sms") smsReplies++;
      else if (channel === "whatsapp") whatsappReplies++;
      else if (channel === "phone_call") phonePickups++;

      replyTimestamps.push({ occurred_at: reply.occurred_at, channel });

      // Step attribution: use execution's last_completed_node_index
      const exec = execMap.get(reply.execution_id);
      if (exec && exec.last_completed_node_index != null) {
        const step = exec.last_completed_node_index < 0 ? 0 : exec.last_completed_node_index;
        repliesByStep.set(step, (repliesByStep.get(step) || 0) + 1);
      }
    }

    const totalReplied = smsReplies + whatsappReplies + phonePickups;
    const replyRate = totalEngaged > 0 ? Math.round((totalReplied / totalEngaged) * 1000) / 10 : 0;

    const smsReplyRate = smsLeads.size > 0 ? Math.round((smsReplies / smsLeads.size) * 1000) / 10 : 0;
    const whatsappReplyRate = whatsappLeads.size > 0 ? Math.round((whatsappReplies / whatsappLeads.size) * 1000) / 10 : 0;
    const phonePickupRate = phoneLeads.size > 0 ? Math.round((phonePickups / phoneLeads.size) * 1000) / 10 : 0;

    // Voice call metrics from call_history
    const voicemailCount = callHistoryData.filter((c: any) => c.voicemail_detected === true).length;
    const pickupCalls = callHistoryData.filter((c: any) => c.human_pickup === true);
    const avgCallDurationSeconds = pickupCalls.length > 0
      ? Math.round(pickupCalls.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0) / pickupCalls.length)
      : null;
    const callSpend = callHistoryData.reduce((sum: number, c: any) => sum + (c.cost || 0), 0);
    const callSpendRounded = Math.round(callSpend * 100) / 100;

    // Avg response time
    let totalResponseMs = 0;
    let responseCount = 0;
    for (const reply of allReplyEvents) {
      const sentForExec = sentByExecution.get(reply.execution_id) || [];
      const sorted = sentForExec
        .filter((s: any) => new Date(s.occurred_at) <= new Date(reply.occurred_at))
        .sort((a: any, b: any) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
      if (sorted.length > 0) {
        totalResponseMs += new Date(reply.occurred_at).getTime() - new Date(sorted[0].occurred_at).getTime();
        responseCount++;
      }
    }
    const avgResponseMinutes = responseCount > 0
      ? Math.round((totalResponseMs / responseCount / 60000) * 10) / 10
      : null;

    // Avg first engagement time
    const enrolledByLead = new Map<string, string>();
    for (const evt of allEnrolledEvents) {
      if (!enrolledByLead.has(evt.lead_id) || evt.occurred_at < enrolledByLead.get(evt.lead_id)!) {
        enrolledByLead.set(evt.lead_id, evt.occurred_at);
      }
    }
    const firstSentByLead = new Map<string, string>();
    for (const evt of allSentEvents) {
      if (!firstSentByLead.has(evt.lead_id) || evt.occurred_at < firstSentByLead.get(evt.lead_id)!) {
        firstSentByLead.set(evt.lead_id, evt.occurred_at);
      }
    }
    let totalEngMs = 0;
    let engCount = 0;
    for (const [leadId, enrolledAt] of enrolledByLead) {
      const firstSent = firstSentByLead.get(leadId);
      if (firstSent) {
        totalEngMs += new Date(firstSent).getTime() - new Date(enrolledAt).getTime();
        engCount++;
      }
    }
    const avgFirstEngagementMinutes = engCount > 0
      ? Math.round((totalEngMs / engCount / 60000) * 10) / 10
      : null;

    // --- Chart data ---

    // Engagements by day
    const engByDay = new Map<string, number>();
    for (const evt of allSentEvents) {
      const day = evt.occurred_at.substring(0, 10);
      engByDay.set(day, (engByDay.get(day) || 0) + 1);
    }
    const engagements_by_day = [...engByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // Replies by day
    const repByDay = new Map<string, number>();
    for (const evt of allReplyEvents) {
      const day = evt.occurred_at.substring(0, 10);
      repByDay.set(day, (repByDay.get(day) || 0) + 1);
    }
    const replies_by_day = [...repByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // Peak response hour
    const hourCounts = new Array(24).fill(0);
    for (const evt of allReplyEvents) {
      const hour = new Date(evt.occurred_at).getUTCHours();
      hourCounts[hour]++;
    }
    const replies_by_hour = hourCounts.map((value, i) => ({
      name: `${i.toString().padStart(2, '0')}:00`,
      value,
    }));

    // Channel distribution
    const channel_distribution = [
      { name: "SMS", value: smsLeads.size },
      { name: "WhatsApp", value: whatsappLeads.size },
      { name: "Phone", value: phoneLeads.size },
    ].filter(d => d.value > 0);

    // Reply vs No Reply donut
    const reply_vs_no_reply = [
      { name: "Replied", value: totalReplied },
      { name: "No Reply", value: Math.max(0, totalEngaged - totalReplied) },
    ];

    // Replies by day of week
    const dowCounts = new Array(7).fill(0);
    const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const evt of allReplyEvents) {
      const dow = new Date(evt.occurred_at).getUTCDay();
      dowCounts[dow]++;
    }
    const replies_by_dow = dowCounts.map((value, i) => ({ name: DOW_NAMES[i], value }));

    // Replies by step (sorted by step number)
    const replies_by_step = [...repliesByStep.entries()]
      .sort(([a], [b]) => a - b)
      .map(([step, replies]) => ({ name: `Engagement #${step}`, value: replies }));

    const appointmentBookedEvents = appointmentBookedRes.data || [];
    const appointmentsBooked = appointmentBookedEvents.length;
    const bookingRate = totalEngaged > 0 ? Math.round((appointmentsBooked / totalEngaged) * 1000) / 10 : 0;

    // Bookings by day chart
    const bookByDay = new Map<string, number>();
    for (const evt of appointmentBookedEvents) {
      const day = evt.occurred_at.substring(0, 10);
      bookByDay.set(day, (bookByDay.get(day) || 0) + 1);
    }
    const bookings_by_day = [...bookByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // Booking funnel
    const booking_funnel = [
      { name: "Enrolled", value: totalEnrolled },
      { name: "Engaged", value: totalEngaged },
      { name: "Replied", value: totalReplied },
      { name: "Booked", value: appointmentsBooked },
    ];

    const stats = {
      total_enrolled: totalEnrolled,
      total_engaged: totalEngaged,
      total_replied: totalReplied,
      reply_rate: replyRate,
      currently_active: (activeRes as any).count ?? 0,
      sequence_complete: (completedRes as any).count ?? 0,
      total_messages_sent: allSentEvents.length,
      sms_engaged: smsLeads.size,
      sms_sent: smsSent,
      sms_replies: smsReplies,
      sms_reply_rate: smsReplyRate,
      whatsapp_engaged: whatsappLeads.size,
      whatsapp_sent: whatsappSent,
      whatsapp_replies: whatsappReplies,
      whatsapp_reply_rate: whatsappReplyRate,
      phone_engaged: phoneLeads.size,
      phone_calls_made: phoneCallsMade,
      phone_pickups: phonePickups,
      phone_pickup_rate: phonePickupRate,
      phone_voicemails: voicemailCount,
      phone_avg_duration: avgCallDurationSeconds,
      phone_call_spend: callSpendRounded,
      avg_response_minutes: avgResponseMinutes,
      avg_first_engagement_minutes: avgFirstEngagementMinutes,
      appointments_booked: appointmentsBooked,
      booking_rate: bookingRate,
      // Chart data
      engagements_by_day,
      replies_by_day,
      replies_by_hour,
      channel_distribution,
      reply_vs_no_reply,
      replies_by_dow,
      replies_by_step,
      bookings_by_day,
      
    };

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-campaign-stats error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function emptyStats() {
  return {
    total_enrolled: 0, total_engaged: 0, total_replied: 0, reply_rate: 0,
    currently_active: 0, sequence_complete: 0,
    total_messages_sent: 0,
    sms_engaged: 0, sms_sent: 0, sms_replies: 0, sms_reply_rate: 0,
    whatsapp_engaged: 0, whatsapp_sent: 0, whatsapp_replies: 0, whatsapp_reply_rate: 0,
    phone_engaged: 0, phone_calls_made: 0, phone_pickups: 0, phone_pickup_rate: 0,
    phone_voicemails: 0, phone_avg_duration: null, phone_call_spend: 0,
    avg_response_minutes: null, avg_first_engagement_minutes: null,
    appointments_booked: 0, booking_rate: 0,
    engagements_by_day: [], replies_by_day: [], replies_by_hour: [],
    channel_distribution: [], reply_vs_no_reply: [], replies_by_dow: [],
    replies_by_step: [], bookings_by_day: [],
  };
}
