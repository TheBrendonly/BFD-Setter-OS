import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUB] ${step}${detailsStr}`);
};

const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() || null;

/**
 * Maps a Stripe subscription to our app-level status.
 * Uses "locked" instead of "past_due" for locked accounts.
 */
function resolveSubStatus(sub: Stripe.Subscription): string {
  if (sub.cancel_at_period_end) return "cancelled";
  switch (sub.status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "locked";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "free";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Stripe is optional. When STRIPE_SECRET_KEY is not configured, the
    // function trusts the DB's subscription_status column and skips the live
    // Stripe verification. This unblocks tenants (like BFD today) whose
    // billing isn't wired yet; the gate still works once Stripe is added.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the JWT signature via GoTrue. (Previously the payload was atob-decoded
    // without verification, trusting forged tokens. getUser(token) validates the
    // token directly and does not require a server-side session.)
    const token = authHeader.replace("Bearer ", "").trim();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: authData.user.id, email: authData.user.email ?? null };

    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep("Checking subscription for client", { client_id, user_id: user.id });

    const { data: client } = await supabase
      .from("clients")
      .select("id, stripe_customer_id, subscription_status, email, agency_id")
      .eq("id", client_id)
      .single();

    if (!client) {
      logStep("Client not found, returning free status", { client_id });
      return new Response(JSON.stringify({ subscribed: false, status: "free" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization check
    const [{ data: roleData }, { data: profileData }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id).limit(1).maybeSingle(),
      supabase.from("profiles").select("agency_id, client_id").eq("id", user.id).maybeSingle(),
    ]);

    const isAuthorized = roleData?.role === "agency"
      ? !!profileData?.agency_id && profileData.agency_id === client.agency_id
      : roleData?.role === "client"
        ? profileData?.client_id === client.id
        : false;

    if (!isAuthorized) {
      logStep("Authorization failed", { client_id, user_id: user.id, role: roleData?.role ?? null });
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stripe-optional path: when STRIPE_SECRET_KEY is not configured, trust
    // the DB's subscription_status without calling Stripe. Returns the same
    // shape the Stripe-verified path returns at the "No subscription found"
    // exit (line ~272), so frontend gate logic is unchanged.
    if (!stripeKey) {
      const status = client.subscription_status || "free";
      logStep("Stripe not configured, returning DB status", { client_id, status });
      return new Response(JSON.stringify({ subscribed: status === "active" || status === "trialing" || status === "lifetime", status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const targetEmails = [normalizeEmail(client.email), normalizeEmail(user.email)].filter(Boolean) as string[];

    let customerId = client.stripe_customer_id;
    let foundSub: Stripe.Subscription | null = null;
    let matchSource: string | null = null;

    // Step 1: Check by existing stripe_customer_id
    if (customerId) {
      logStep("Checking existing customer", { customerId });
      const subs = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
      const activeSub = subs.data.find((s) => (s.status === "active" || s.status === "trialing") && !s.cancel_at_period_end);
      const anySub = subs.data.find((s) => s.status === "active" || s.status === "trialing");
      const latestSub = activeSub || anySub || subs.data[0] || null;

      if (latestSub) {
        foundSub = latestSub;
        matchSource = "stripe_customer_id";
        logStep("Found sub via customer_id", { id: latestSub.id, status: latestSub.status });
      }
    }

    // Step 2: Search by email
    if (!foundSub && targetEmails.length > 0) {
      for (const emailToSearch of targetEmails) {
        logStep("Searching customers by email", { email: emailToSearch });
        const customers = await stripe.customers.list({ email: emailToSearch, limit: 5 });
        for (const cust of customers.data) {
          const subs = await stripe.subscriptions.list({ customer: cust.id, limit: 5 });
          const activeSub = subs.data.find((s) => (s.status === "active" || s.status === "trialing") && !s.cancel_at_period_end);
          const anySub = subs.data.find((s) => s.status === "active" || s.status === "trialing");
          const latestSub = activeSub || anySub || null;

          if (latestSub) {
            customerId = cust.id;
            foundSub = latestSub;
            matchSource = "customer_email";
            break;
          }
        }
        if (foundSub) break;
      }
    }

    // Step 3: Search checkout sessions as last resort
    if (!foundSub) {
      logStep("Searching checkout sessions", { client_id });
      try {
        const sessions = await stripe.checkout.sessions.list({ limit: 100 });
        const paidSessions = sessions.data.filter((s) => s.payment_status === "paid");

        const exactMatch = paidSessions.find((s) =>
          s.client_reference_id === client_id || s.metadata?.client_id === client_id
        );

        const fallbackCandidates = paidSessions.filter((s) => {
          const sessionEmail = normalizeEmail(s.customer_details?.email || s.customer_email || null);
          const matchesEmail = !!sessionEmail && targetEmails.includes(sessionEmail);
          const matchesUserMeta = s.metadata?.user_id === user.id;
          const hasNoClientBinding = !s.client_reference_id && !s.metadata?.client_id;
          return hasNoClientBinding && (matchesEmail || matchesUserMeta);
        });

        const matchedSession = exactMatch || fallbackCandidates[0];
        if (matchedSession?.subscription) {
          const subId = typeof matchedSession.subscription === "string" ? matchedSession.subscription : null;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            customerId = typeof matchedSession.customer === "string" ? matchedSession.customer : customerId;
            foundSub = sub;
            matchSource = exactMatch ? "checkout_exact" : "checkout_fallback";
          }
        }
      } catch (sessionError) {
        logStep("Error searching sessions", {
          error: sessionError instanceof Error ? sessionError.message : String(sessionError),
        });
      }
    }

    // Step 4: Determine final status and update DB
    if (foundSub && customerId) {
      const appStatus = resolveSubStatus(foundSub);
      const subscriptionId = foundSub.id;
      const endDate = foundSub.current_period_end
        ? new Date(foundSub.current_period_end * 1000).toISOString()
        : null;

      const updateFields: Record<string, any> = {
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        subscription_status: appStatus,
      };

      if (appStatus === "active") {
        updateFields.subscription_start_date = new Date().toISOString();
        updateFields.payment_failed_date = null;
        updateFields.retry_count = 0;
        updateFields.last_retry_date = null;
      }
      if (endDate) {
        updateFields.subscription_end_date = endDate;
      }

      // Don't overwrite grace_period/locked from webhook with active from polling
      // if there's an active payment failure in progress
      const currentDbStatus = client.subscription_status;
      if (
        appStatus === "active" &&
        (currentDbStatus === "grace_period" || currentDbStatus === "locked")
      ) {
        logStep("Skipping active overwrite — payment issue managed by webhook", { client_id, currentDbStatus });
      } else {
        await supabase.from("clients").update(updateFields).eq("id", client_id);
      }

      logStep(`Client subscription ${appStatus.toUpperCase()}`, { client_id, customerId, matchSource });

      return new Response(JSON.stringify({
        subscribed: appStatus === "active",
        status: appStatus,
        subscription_end: endDate,
        cancel_at_period_end: foundSub.cancel_at_period_end || false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No subscription found — if DB says active, mark as cancelled
    if (client.subscription_status === "active" || client.subscription_status === "grace_period") {
      await supabase
        .from("clients")
        .update({
          subscription_status: "cancelled",
          payment_failed_date: null,
          retry_count: 0,
          last_retry_date: null,
        })
        .eq("id", client_id);

      logStep("Client subscription DEACTIVATED (no sub found)", { client_id });
      return new Response(JSON.stringify({ subscribed: false, status: "cancelled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep("No subscription found", { client_id, currentStatus: client.subscription_status });
    return new Response(JSON.stringify({ subscribed: false, status: client.subscription_status || "free" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    logStep("ERROR", { message: error instanceof Error ? error.message : String(error) });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
