import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const log = (step: string, details?: any) => {
  const d = details ? ` — ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-WEBHOOK] ${step}${d}`);
};

// Basil API (2025-08-27) moved current_period_end off the Subscription onto its
// items. Our subscriptions are single-item, so read it from items.data[0];
// returns an ISO string or null. (Reading subscription.current_period_end
// directly is undefined under this apiVersion -> subscription_end_date would
// silently store null.)
const subPeriodEnd = (sub: Stripe.Subscription): string | null => {
  const ts = sub.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
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

    // ── Idempotency claim (B2.1) ──
    // Claim the event id BEFORE processing. The insert succeeds exactly once; a
    // 23505 unique violation means a prior delivery already processed it -> return
    // 200 without reprocessing (protects the non-idempotent invoice.payment_failed
    // retry_count increment from Stripe retries / replays). If the handler body
    // below throws, we DELETE this claim before returning 500 so Stripe's retry is
    // not dedup-swallowed.
    {
      const { error: claimError } = await supabase
        .from("stripe_webhook_events")
        .insert({ event_id: event.id, type: event.type });
      if (claimError) {
        if (claimError.code === "23505") {
          log("Duplicate event — already processed, skipping", { id: event.id, type: event.type });
          return new Response(JSON.stringify({ received: true, duplicate: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // A non-dedup insert failure (e.g. table missing / transient DB error)
        // must not silently process without a claim. Fail closed -> Stripe retries.
        log("ERROR: failed to claim event id", { id: event.id, error: claimError.message });
        return new Response(JSON.stringify({ error: "Failed to record event" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

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

    // Wrap handling so a throw releases the idempotency claim (B2.1) before the
    // outer catch returns 500 and Stripe retries — otherwise the retry would be
    // dedup-swallowed and the event lost.
    try {
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

        // B2.2: only TERMINAL states cancel the account here. A pending
        // cancel_at_period_end (status still active/trialing) must NOT flip to
        // 'cancelled' — that would paywall a user who has paid through
        // current_period_end. It falls through to the active branch below, which
        // keeps 'active' and stamps subscription_end_date. The actual cancel
        // lands later via customer.subscription.deleted at period end.
        if (
          subscription.status === "canceled" ||
          subscription.status === "unpaid"
        ) {
          await supabase
            .from("clients")
            .update({
              subscription_status: "cancelled",
              subscription_end_date: subPeriodEnd(subscription),
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
              subscription_end_date: subPeriodEnd(subscription),
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
    } catch (handlerErr) {
      // Release the claim so Stripe's retry of this event is processed, not deduped.
      await supabase.from("stripe_webhook_events").delete().eq("event_id", event.id);
      log("Handler threw — released event claim for retry", { id: event.id });
      throw handlerErr;
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
