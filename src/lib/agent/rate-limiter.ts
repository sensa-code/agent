// ============================================================================
// VetEvidence — Rate Limiting + Usage Tracking
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: string;
}

export interface UsageRecord {
  userId: string;
  action: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  latencyMs: number;
  model: string;
  timestamp: Date;
}

// Rate limit tiers
const RATE_LIMITS = {
  free: {
    requestsPerHour: 20,
    requestsPerDay: 100,
    tokensPerDay: 100000,
    deepResearchPerDay: 3,
  },
  pro: {
    requestsPerHour: 100,
    requestsPerDay: 1000,
    tokensPerDay: 1000000,
    deepResearchPerDay: 20,
  },
  enterprise: {
    requestsPerHour: 500,
    requestsPerDay: 10000,
    tokensPerDay: 10000000,
    deepResearchPerDay: 100,
  },
} as const;

type Tier = keyof typeof RATE_LIMITS;

// In-memory rate limit cache (per-process)
const rateLimitCache = new Map<string, { count: number; resetAt: number }>();

/**
 * Check rate limit for a user
 */
export async function checkRateLimit(
  userId: string,
  action: string = "chat",
  tier: Tier = "free"
): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[tier];
  const now = Date.now();
  const hourKey = `${userId}:${action}:hour`;
  const dayKey = `${userId}:${action}:day`;

  // Check hourly limit
  const hourCache = rateLimitCache.get(hourKey);
  if (hourCache) {
    if (now < hourCache.resetAt) {
      if (hourCache.count >= limits.requestsPerHour) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(hourCache.resetAt),
          reason: `每小時請求上限 ${limits.requestsPerHour} 次已達到`,
        };
      }
    } else {
      // Reset
      rateLimitCache.set(hourKey, { count: 0, resetAt: now + 3600000 });
    }
  } else {
    rateLimitCache.set(hourKey, { count: 0, resetAt: now + 3600000 });
  }

  // Check daily limit
  const dayCache = rateLimitCache.get(dayKey);
  if (dayCache) {
    if (now < dayCache.resetAt) {
      if (dayCache.count >= limits.requestsPerDay) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(dayCache.resetAt),
          reason: `每日請求上限 ${limits.requestsPerDay} 次已達到`,
        };
      }
    } else {
      rateLimitCache.set(dayKey, { count: 0, resetAt: now + 86400000 });
    }
  } else {
    rateLimitCache.set(dayKey, { count: 0, resetAt: now + 86400000 });
  }

  // Increment counters
  const hour = rateLimitCache.get(hourKey)!;
  hour.count++;
  const day = rateLimitCache.get(dayKey)!;
  day.count++;

  return {
    allowed: true,
    remaining: Math.min(
      limits.requestsPerHour - hour.count,
      limits.requestsPerDay - day.count
    ),
    resetAt: new Date(Math.min(hour.resetAt, day.resetAt)),
  };
}

/**
 * Log usage to Supabase for tracking and billing
 */
export async function logUsage(record: UsageRecord): Promise<void> {
  try {
    await supabase
      .from("usage_logs")
      .insert({
        user_id: record.userId,
        action: record.action,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        tool_calls: record.toolCalls,
        latency_ms: record.latencyMs,
        model: record.model,
        created_at: record.timestamp.toISOString(),
      });
  } catch (error) {
    // Non-critical — don't fail the request
    console.error("Failed to log usage:", error);
  }
}

/**
 * Get usage statistics for a user
 */
export async function getUserUsageStats(
  userId: string,
  days: number = 30
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalToolCalls: number;
  avgLatencyMs: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const { data, error } = await supabase
      .from("usage_logs")
      .select("input_tokens, output_tokens, tool_calls, latency_ms")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString());

    if (error || !data) {
      return { totalRequests: 0, totalTokens: 0, totalToolCalls: 0, avgLatencyMs: 0 };
    }

    const totalTokens = data.reduce(
      (sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0),
      0
    );
    const totalToolCalls = data.reduce(
      (sum, r) => sum + (r.tool_calls || 0),
      0
    );
    const avgLatency = data.length > 0
      ? data.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / data.length
      : 0;

    return {
      totalRequests: data.length,
      totalTokens,
      totalToolCalls,
      avgLatencyMs: Math.round(avgLatency),
    };
  } catch {
    return { totalRequests: 0, totalTokens: 0, totalToolCalls: 0, avgLatencyMs: 0 };
  }
}
