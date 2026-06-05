import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const log = (step: string, details?: any) => {
  const d = details ? ` — ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-WEBHOOK] ${step}${d}`);
};

Deno.serve(async (req) => {
  // Log every incoming request immediately (do NOT dump headers — they carry the
  // stripe-signature / authorization secrets).
  console.log("[STRIPE-WEBHOOK] Incoming request:", { method: req.method });

  try {
    // Handle non-POST methods gracefully
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
        },
      });
    }

    if (req.method !== "POST") {
      log("Rejected non-POST request", { method: req.method });
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      log("ERROR: STRIPE_SECRET_KEY not configured");
      return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      // Fail closed: without the signing secret we cannot verify the event came
      // from Stripe, so refuse rather than process a potentially forged webhook.
      log("ERROR: STRIPE_WEBHOOK_SECRET not configured — refusing unverified webhook");
      return new Response(JSON.stringify({ error: "Webhook signature verification not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      log("ERROR: Supabase env vars missing");
      return new Response(JSON.stringify({ error: "Supabase configuration missing" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    // Fail closed: a missing signature header means we cannot prove the event came
    // from Stripe. (webhookSecret is guaranteed set — we returned above otherwise.)
    if (!sig) {
      log("ERROR: Missing stripe-signature header — refusing unverified webhook");
      return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
      log("Signature verified");
    } catch (verifyErr) {
      log("ERROR: Webhook signature verification failed", {
        error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
      });
      return new Response(JSON.stringify({ error: "Webhook signature verification failed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    log("Event received", { type: event.type, id: event.id });

    // ── Helpers ──

    const logAttempt = async (
      clientId: string,
      attemptNumber: number,
      attemptType: string,
      result: string,
      failureReason?: string,
      stripeInvoiceId?: string,
    ) => {
      try {
        const { error } = await supabase.from("payment_attempts").insert({
          client_id: clientId,
          attempted_at: new Date().toISOString(),
          attempt_number: attemptNumber,
          attempt_type: attemptType,
          result,
          failure_reason: failureReason || null,
          stripe_invoice_id: stripeInvoiceId || null,
        });
        if (error) log("Failed to log payment attempt", { error: error.message });
        else log("Payment attempt logged", { clientId, attemptNumber, result });
      } catch (err) {
        log("Exception logging payment attempt", { error: err instanceof Error ? err.message : String(err) });
      }
    };

    const findClient = async (customerId: string) => {
      try {
        const { data } = await supabase
          .from("clients")
          .select("id, payment_failed_date, retry_count, subscription_status")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        return data;
      } catch (err) {
        log("Exception in findClient", { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    };

    const findProfile = async (customerId: string) => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, payment_failed_date, retry_count, subscription_status")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        return data;
      } catch (err) {
        log("Exception in findProfile", { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    };

    switch (event.type) {
      // ─── CHECKOUT COMPLETED ───
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        const activateFields = {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          subscription_status: "active",
          subscription_start_date: new Date().toISOString(),
          payment_failed_date: null,
          retry_count: 0,
          last_retry_date: null,
        };

        if (metadata.type === "agency" && metadata.user_id) {
          await supabase.from("profiles").update(activateFields).eq("id", metadata.user_id);
          log("Agency subscription activated", { userId: metadata.user_id });
        } else if (metadata.type === "client" && metadata.client_id) {
          await supabase.from("clients").update(activateFields).eq("id", metadata.client_id);
          await logAttempt(metadata.client_id, 1, "manual", "success");
          log("Client subscription activated", { clientId: metadata.client_id });
        }

        if (!metadata.client_id && session.client_reference_id) {
          const refId = session.client_reference_id;
          const { data: existing } = await supabase
            .from("clients")
            .select("id")
            .eq("id", refId)
            .maybeSingle();

          if (existing) {
            await supabase.from("clients").update(activateFields).eq("id", refId);
            await logAttempt(refId, 1, "manual", "success");
            log("Client activated via client_reference_id", { clientId: refId });
          }
        }
        break;
      }

      // ─── PAYMENT FAILED ───
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const now = new Date().toISOString();
        const invoiceId = invoice.id;
        const failureMessage =
          (invoice as any).last_finalization_error?.message ||
          (invoice as any).charge?.failure_message ||
          "Payment declined";

        const client = await findClient(customerId);

        if (client) {
          const newRetryCount = (client.retry_count || 0) + 1;
          const paymentFailedDate = client.payment_failed_date || now;
          const newStatus = newRetryCount >= 3 ? "locked" : "grace_period";

          const { error } = await supabase
            .from("clients")
            .update({
              subscription_status: newStatus,
              payment_failed_date: paymentFailedDate,
              retry_count: newRetryCount,
              last_retry_date: now,
            })
            .eq("id", client.id);

          if (error) log("ERROR updating client on payment_failed", { error: error.message });

          await logAttempt(client.id, newRetryCount, "automatic", "failed", failureMessage, invoiceId);
          log("Payment failed processed", { clientId: client.id, retryCount: newRetryCount, newStatus });
        } else {
          const profile = await findProfile(customerId);
          if (profile) {
            const newRetryCount = (profile.retry_count || 0) + 1;
            const paymentFailedDate = profile.payment_failed_date || now;
            const newStatus = newRetryCount >= 3 ? "locked" : "grace_period";

            await supabase
              .from("profiles")
              .update({
                subscription_status: newStatus,
                payment_failed_date: paymentFailedDate,
                retry_count: newRetryCount,
                last_retry_date: now,
              })
              .eq("id", profile.id);

            log("Agency payment failed processed", { profileId: profile.id, retryCount: newRetryCount, newStatus });
          } else {
            log("No client or profile found for customer", { customerId });
          }
        }
        break;
      }

      // ─── PAYMENT SUCCEEDED ───
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const invoiceId = invoice.id;

        const client = await findClient(customerId);

        if (client) {
          const attemptNum = (client.retry_count || 0) + 1;

          const { error } = await supabase
            .from("clients")
            .update({
              subscription_status: "active",
              payment_failed_date: null,
              retry_count: 0,
              last_retry_date: null,
            })
            .eq("id", client.id);

          if (error) log("ERROR updating client on payment_succeeded", { error: error.message });

          await logAttempt(client.id, attemptNum, "automatic", "success", undefined, invoiceId);
          log("Payment succeeded, reactivated", { clientId: client.id });
        } else {
          const profile = await findProfile(customerId);
          if (profile) {
            await supabase
              .from("profiles")
              .update({
                subscription_status: "active",
                payment_failed_date: null,
                retry_count: 0,
                last_retry_date: null,
              })
              .eq("id", profile.id);

            log("Agency payment succeeded, reactivated", { profileId: profile.id });
          } else {
            log("No client or profile found for customer", { customerId });
          }
        }
        break;
      }

      // ─── SUBSCRIPTION UPDATED ───
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const client = await findClient(customerId);
        if (!client) {
          log("No client found for subscription.updated", { customerId });
          break;
        }

        const currentStatus = client.subscription_status;
        const hasPaymentIssue = currentStatus === "grace_period" || currentStatus === "locked";

        if (
          subscription.status === "canceled" ||
          subscription.status === "unpaid" ||
          subscription.cancel_at_period_end
        ) {
          await supabase
            .from("clients")
            .update({
              subscription_status: "cancelled",
              subscription_end_date: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
            })
            .eq("id", client.id);

          await logAttempt(client.id, (client.retry_count || 0) + 1, "automatic", "cancelled", `Subscription ${subscription.status}`);
          log("Subscription cancelled", { clientId: client.id });
          break;
        }

        if (
          (subscription.status === "active" || subscription.status === "trialing") &&
          hasPaymentIssue &&
          (client.retry_count || 0) > 0
        ) {
          log("Skipping status overwrite — payment issue in progress", {
            clientId: client.id,
            currentStatus,
            retryCount: client.retry_count,
          });
          break;
        }

        if (subscription.status === "active" || subscription.status === "trialing") {
          await supabase
            .from("clients")
            .update({
              subscription_status: "active",
              payment_failed_date: null,
              retry_count: 0,
              last_retry_date: null,
              subscription_end_date: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
            })
            .eq("id", client.id);

          log("Subscription updated to active", { clientId: client.id });
        } else if (subscription.status === "past_due") {
          await supabase
            .from("clients")
            .update({ subscription_status: "locked" })
            .eq("id", client.id);

          await logAttempt(client.id, (client.retry_count || 0) + 1, "automatic", "failed", "Subscription past_due");
          log("Subscription updated to locked (Stripe past_due)", { clientId: client.id });
        }
        break;
      }

      // ─── SUBSCRIPTION DELETED ───
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const deletedClient = await findClient(customerId);
        const hadPaymentIssue = deletedClient && (
          (deletedClient.retry_count || 0) > 0 ||
          deletedClient.subscription_status === "grace_period" ||
          deletedClient.subscription_status === "locked"
        );

        if (hadPaymentIssue && deletedClient) {
          await supabase
            .from("clients")
            .update({
              subscription_status: "locked",
              subscription_end_date: new Date().toISOString(),
            })
            .eq("id", deletedClient.id);

          await logAttempt(deletedClient.id, (deletedClient.retry_count || 0) + 1, "automatic", "failed", "Subscription deleted after failed retries");
          log("Subscription deleted due to payment failure — locked", { clientId: deletedClient.id });
        } else {
          const { error } = await supabase
            .from("clients")
            .update({
              subscription_status: "cancelled",
              payment_failed_date: null,
              retry_count: 0,
              last_retry_date: null,
            })
            .eq("stripe_customer_id", customerId);

          if (error) log("ERROR on subscription.deleted", { error: error.message });

          if (deletedClient) {
            await logAttempt(deletedClient.id, 1, "manual", "cancelled", "User cancelled subscription");
          }
          log("Subscription cancelled (user-initiated)", { customerId });
        }
        break;
      }

      default:
        log("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[STRIPE-WEBHOOK] Unhandled error:", errorMessage);
    if (errorStack) console.error("[STRIPE-WEBHOOK] Stack:", errorStack);

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
