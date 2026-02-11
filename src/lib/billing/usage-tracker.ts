// ============================================================================
// VetEvidence — Usage Tracking + Tier Limiting
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { getUserSubscription, PLANS } from "./subscription";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Types ───

export interface UsageLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  tier: string;
  upgradeMessage?: string;
}

export interface DailyUsageStats {
  requestCount: number;
  deepResearchCount: number;
  imageAnalysisCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// In-memory usage tracking (per-process, reset daily)
const usageCache = new Map<
  string,
  { count: number; date: string; deepResearch: number; imageAnalysis: number; tokens: number }
>();

/**
 * Check if user is within their tier limits
 */
export async function checkUsageLimit(
  userId: string,
  action: "chat" | "deep_research" | "image_analysis" = "chat"
): Promise<UsageLimitResult> {
  const sub = await getUserSubscription(userId);
  const plan = PLANS[sub.tier] || PLANS.free;
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `${userId}:${today}`;

  // Get or initialize usage for today
  let usage = usageCache.get(cacheKey);
  if (!usage || usage.date !== today) {
    // Try to load from DB
    const dbUsage = await loadDailyUsageFromDB(userId, today);
    usage = {
      count: dbUsage.requestCount,
      date: today,
      deepResearch: dbUsage.deepResearchCount,
      imageAnalysis: dbUsage.imageAnalysisCount,
      tokens: dbUsage.totalTokens,
    };
    usageCache.set(cacheKey, usage);
  }

  // Check limits based on action type
  let currentCount: number;
  let limit: number;

  switch (action) {
    case "deep_research":
      currentCount = usage.deepResearch;
      limit = plan.limits.deepResearchPerDay;
      break;
    case "image_analysis":
      currentCount = usage.imageAnalysis;
      limit = plan.limits.imageAnalysisPerDay;
      break;
    default:
      currentCount = usage.count;
      limit = plan.limits.requestsPerDay;
      break;
  }

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      tier: sub.tier,
      upgradeMessage:
        sub.tier === "free"
          ? "您已達到免費版每日上限。升級至專業版享受無限次數查詢！Visit /pricing to upgrade."
          : sub.tier === "pro"
            ? "您已達到專業版每日上限。請聯絡我們升級企業版。"
            : "已達到每日上限，請明天再試。",
    };
  }

  return {
    allowed: true,
    remaining: limit - currentCount,
    limit,
    tier: sub.tier,
  };
}

/**
 * Increment usage counter after a successful request
 */
export async function incrementUsage(
  userId: string,
  action: "chat" | "deep_research" | "image_analysis",
  tokensUsed: number = 0
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `${userId}:${today}`;

  let usage = usageCache.get(cacheKey);
  if (!usage || usage.date !== today) {
    usage = { count: 0, date: today, deepResearch: 0, imageAnalysis: 0, tokens: 0 };
    usageCache.set(cacheKey, usage);
  }

  usage.count++;
  usage.tokens += tokensUsed;
  if (action === "deep_research") usage.deepResearch++;
  if (action === "image_analysis") usage.imageAnalysis++;

  // Persist to DB (non-blocking)
  persistUsageToDB(userId, action, tokensUsed).catch((err) => {
    console.error("Failed to persist usage:", err);
  });
}

/**
 * Get today's usage count for a user (used by gate tests)
 */
export async function getTodayUsageCount(userId: string): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `${userId}:${today}`;
  const usage = usageCache.get(cacheKey);
  return usage?.count || 0;
}

/**
 * Reset usage for testing purposes
 */
export function resetUsageCache(): void {
  usageCache.clear();
}

// ─── DB Persistence ───

async function loadDailyUsageFromDB(
  userId: string,
  date: string
): Promise<DailyUsageStats> {
  try {
    const startOfDay = `${date}T00:00:00.000Z`;
    const endOfDay = `${date}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from("usage_logs")
      .select("action, input_tokens, output_tokens")
      .eq("user_id", userId)
      .gte("created_at", startOfDay)
      .lte("created_at", endOfDay);

    if (error || !data) {
      return {
        requestCount: 0,
        deepResearchCount: 0,
        imageAnalysisCount: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
    }

    let totalTokens = 0;
    let deepResearchCount = 0;
    let imageAnalysisCount = 0;

    for (const row of data) {
      totalTokens += (row.input_tokens || 0) + (row.output_tokens || 0);
      if (row.action === "deep_research") deepResearchCount++;
      if (row.action === "image_analysis") imageAnalysisCount++;
    }

    return {
      requestCount: data.length,
      deepResearchCount,
      imageAnalysisCount,
      totalTokens,
      estimatedCostUsd: estimateCost(totalTokens),
    };
  } catch {
    return {
      requestCount: 0,
      deepResearchCount: 0,
      imageAnalysisCount: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }
}

async function persistUsageToDB(
  userId: string,
  action: string,
  tokensUsed: number
): Promise<void> {
  try {
    await supabase.from("usage_logs").insert({
      user_id: userId,
      action,
      input_tokens: Math.floor(tokensUsed * 0.6),
      output_tokens: Math.floor(tokensUsed * 0.4),
      tool_calls: 0,
      latency_ms: 0,
      model: "claude-sonnet-4-5-20250929",
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical
  }
}

function estimateCost(totalTokens: number): number {
  // Claude Sonnet 4.5: ~$3/M input, ~$15/M output
  // Rough average: $6/M tokens
  return (totalTokens / 1000000) * 6;
}
