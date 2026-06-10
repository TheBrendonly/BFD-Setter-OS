import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { type, client_id, return_url, checkout_email } = await req.json();

    // SECURITY: the service-role client bypasses RLS; verify the caller owns this
    // client before reading its details / creating a checkout on its behalf.
    if (type === "client" && client_id) {
      try {
        await authorizeClientRequest(authHeader, client_id);
      } catch (e) {
        if (e instanceof AssertAccessError) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let metadata: Record<string, string> = {};

    if (type === "agency") {
      metadata = { user_id: user.id, type: "agency" };
    } else if (type === "client") {
      metadata = { type: "client", user_id: user.id };
      if (client_id) metadata.client_id = client_id;
    } else {
      return new Response(JSON.stringify({ error: "Invalid type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LIVE_PRODUCT_ID = "prod_UGkEJ0TvzIgHRd";

    const clientResult = client_id && type === "client"
      ? await supabase.from("clients").select("email").eq("id", client_id).single()
      : null;

    // For client subscriptions, strictly use the sub-account email
    let customerEmail: string;
    if (type === "client" && client_id) {
      const clientEmail = clientResult?.data?.email;
      if (!clientEmail) {
        throw new Error("Sub-account has no email set. Please add an email to the sub-account before subscribing.");
      }
      customerEmail = clientEmail;
    } else {
      customerEmail = checkout_email || user.email;
      if (!customerEmail) {
        throw new Error("No email available for checkout");
      }
    }

    const customersResult = await stripe.customers.list({ email: customerEmail, limit: 1 });

    let customerId: string;
    if (customersResult.data.length > 0) {
      customerId = customersResult.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: customerEmail, metadata });
      customerId = customer.id;
    }

    // Find the active price for the live product
    const pricesResult = await stripe.prices.list({
      product: LIVE_PRODUCT_ID,
      active: true,
      type: "recurring",
      limit: 1,
    });

    let priceId: string;
    if (pricesResult.data.length > 0) {
      priceId = pricesResult.data[0].id;
    } else {
      throw new Error("No active recurring price found for live product " + LIVE_PRODUCT_ID);
    }

    const baseSuccessUrl = return_url || `${req.headers.get("origin")}/`;
    const successUrl = new URL(baseSuccessUrl);
    successUrl.searchParams.set("checkout_success", "true");
    if (client_id) successUrl.searchParams.set("checkout_client_id", client_id);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: client_id || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: successUrl.toString(),
      cancel_url: return_url || `${req.headers.get("origin")}/`,
      metadata,
      subscription_data: { metadata },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
