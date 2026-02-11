// ============================================================================
// VetEvidence — Stripe Webhook Handler
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  updateUserSubscription,
  stripePriceToTier,
} from "@/lib/billing/subscription";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook — Handle Stripe webhook events
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const signature = request.headers.get("stripe-signature");

    // In production, verify the Stripe signature using STRIPE_WEBHOOK_SECRET
    // For now, accept all requests (test mode)
    if (!body || !body.type) {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      );
    }

    const event = body;

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data?.object;
        if (!subscription) break;

        const customerId = subscription.customer;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const tier = priceId ? stripePriceToTier(priceId) : "free";

        await updateUserSubscription(customerId, {
          tier,
          status: subscription.status === "active" ? "active" : subscription.status,
          stripeSubscriptionId: subscription.id,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : undefined,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data?.object;
        if (!subscription) break;

        await updateUserSubscription(subscription.customer, {
          tier: "free",
          status: "cancelled",
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data?.object;
        if (!invoice) break;

        await updateUserSubscription(invoice.customer, {
          status: "past_due",
        });
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
