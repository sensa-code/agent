// ============================================================================
// VetEvidence — Stripe Subscription Integration
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Subscription Plans ───

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: "free" | "pro" | "enterprise";
  priceMonthly: number; // USD cents
  priceYearly: number; // USD cents
  features: string[];
  limits: {
    requestsPerDay: number;
    deepResearchPerDay: number;
    imageAnalysisPerDay: number;
    tokensPerDay: number;
  };
}

export const PLANS: Record<string, SubscriptionPlan> = {
  free: {
    id: "plan_free",
    name: "免費版",
    tier: "free",
    priceMonthly: 0,
    priceYearly: 0,
    features: ["基本臨床問答", "藥物查詢", "臨床計算器"],
    limits: {
      requestsPerDay: 10,
      deepResearchPerDay: 1,
      imageAnalysisPerDay: 2,
      tokensPerDay: 50000,
    },
  },
  pro: {
    id: "plan_pro",
    name: "專業版",
    tier: "pro",
    priceMonthly: 4900, // $49/month
    priceYearly: 47000, // $470/year ($39.17/month)
    features: [
      "無限臨床問答",
      "深度研究報告",
      "影像分析",
      "優先回應",
      "API 存取",
    ],
    limits: {
      requestsPerDay: 1000,
      deepResearchPerDay: 20,
      imageAnalysisPerDay: 50,
      tokensPerDay: 1000000,
    },
  },
  enterprise: {
    id: "plan_enterprise",
    name: "企業版",
    tier: "enterprise",
    priceMonthly: 19900, // $199/month
    priceYearly: 190000, // $1900/year
    features: [
      "無限所有功能",
      "專屬 API Key",
      "客製化系統提示",
      "優先技術支援",
      "SLA 保證",
    ],
    limits: {
      requestsPerDay: 10000,
      deepResearchPerDay: 100,
      imageAnalysisPerDay: 500,
      tokensPerDay: 10000000,
    },
  },
};

// ─── User Subscription ───

export interface UserSubscription {
  userId: string;
  tier: "free" | "pro" | "enterprise";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: "active" | "cancelled" | "past_due" | "trialing";
  currentPeriodEnd?: Date;
}

/**
 * Get user subscription (defaults to free)
 */
export async function getUserSubscription(
  userId: string
): Promise<UserSubscription> {
  try {
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return {
        userId,
        tier: "free",
        status: "active",
      };
    }

    return {
      userId: data.user_id,
      tier: data.tier || "free",
      stripeCustomerId: data.stripe_customer_id,
      stripeSubscriptionId: data.stripe_subscription_id,
      status: data.status || "active",
      currentPeriodEnd: data.current_period_end
        ? new Date(data.current_period_end)
        : undefined,
    };
  } catch {
    return {
      userId,
      tier: "free",
      status: "active",
    };
  }
}

/**
 * Update user subscription after Stripe webhook
 */
export async function updateUserSubscription(
  stripeCustomerId: string,
  update: {
    tier?: string;
    status?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: string;
  }
): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (update.tier) updateData.tier = update.tier;
    if (update.status) updateData.status = update.status;
    if (update.stripeSubscriptionId)
      updateData.stripe_subscription_id = update.stripeSubscriptionId;
    if (update.currentPeriodEnd)
      updateData.current_period_end = update.currentPeriodEnd;

    const { error } = await supabase
      .from("user_subscriptions")
      .update(updateData)
      .eq("stripe_customer_id", stripeCustomerId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Create or get Stripe customer (mock for testing without Stripe SDK)
 */
export async function ensureStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  // Check if customer already exists
  const sub = await getUserSubscription(userId);
  if (sub.stripeCustomerId) return sub.stripeCustomerId;

  // In production, this would call Stripe API
  // For now, generate a mock customer ID
  const customerId = `cus_${generateId()}`;

  try {
    await supabase.from("user_subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      tier: "free",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical
  }

  return customerId;
}

/**
 * Map Stripe price ID to tier
 */
export function stripePriceToTier(
  priceId: string
): "free" | "pro" | "enterprise" {
  // In production, these would be actual Stripe price IDs
  const priceMap: Record<string, "free" | "pro" | "enterprise"> = {
    price_free: "free",
    price_pro_monthly: "pro",
    price_pro_yearly: "pro",
    price_enterprise_monthly: "enterprise",
    price_enterprise_yearly: "enterprise",
  };
  return priceMap[priceId] || "free";
}

// ─── Helpers ───

function generateId(): string {
  return Array.from({ length: 24 }, () =>
    Math.random().toString(36).charAt(2)
  ).join("");
}
