// ============================================================================
// VetEvidence — Cost Tracking + Budget Management
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Pricing Constants ───

// Claude Sonnet 4.5 pricing (per million tokens)
const PRICING = {
  "claude-sonnet-4-5-20250929": {
    inputPerMillion: 3.0, // $3/M input tokens
    outputPerMillion: 15.0, // $15/M output tokens
  },
  default: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
} as const;

// ─── Types ───

export interface CostRecord {
  messageId: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  action: string;
  timestamp: Date;
}

export interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  avgCostPerRequest: number;
  costByAction: Record<string, number>;
  costByDay: Array<{ date: string; cost: number; requests: number }>;
}

// In-memory daily cost accumulator
const dailyCosts = new Map<string, number>();

/**
 * Calculate cost for a single API call
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing =
    PRICING[model as keyof typeof PRICING] || PRICING.default;
  const inputCost = (inputTokens / 1000000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1000000) * pricing.outputPerMillion;
  return Math.round((inputCost + outputCost) * 1000000) / 1000000; // 6 decimal places
}

/**
 * Track cost for a completed API call
 */
export async function trackCost(record: CostRecord): Promise<void> {
  // Update in-memory accumulator
  const today = new Date().toISOString().split("T")[0];
  const current = dailyCosts.get(today) || 0;
  dailyCosts.set(today, current + record.costUsd);

  // Persist to DB
  try {
    await supabase.from("cost_records").insert({
      message_id: record.messageId,
      user_id: record.userId,
      model: record.model,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cost_usd: record.costUsd,
      action: record.action,
      created_at: record.timestamp.toISOString(),
    });
  } catch (err) {
    console.error("Failed to track cost:", err);
  }
}

/**
 * Get total cost for today (used by gate tests)
 */
export function getTodayCost(): number {
  const today = new Date().toISOString().split("T")[0];
  return dailyCosts.get(today) || 0;
}

/**
 * Get cost summary for a period
 */
export async function getCostSummary(
  days: number = 30,
  userId?: string
): Promise<CostSummary> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    let query = supabase
      .from("cost_records")
      .select("*")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return {
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
        avgCostPerRequest: 0,
        costByAction: {},
        costByDay: [],
      };
    }

    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;
    const costByAction: Record<string, number> = {};
    const costByDayMap: Record<string, { cost: number; requests: number }> = {};

    for (const row of data) {
      const cost = row.cost_usd || 0;
      totalCost += cost;
      totalInput += row.input_tokens || 0;
      totalOutput += row.output_tokens || 0;

      const action = row.action || "chat";
      costByAction[action] = (costByAction[action] || 0) + cost;

      const day = (row.created_at || "").split("T")[0];
      if (!costByDayMap[day]) {
        costByDayMap[day] = { cost: 0, requests: 0 };
      }
      costByDayMap[day].cost += cost;
      costByDayMap[day].requests++;
    }

    return {
      totalCostUsd: Math.round(totalCost * 100) / 100,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalRequests: data.length,
      avgCostPerRequest:
        data.length > 0
          ? Math.round((totalCost / data.length) * 10000) / 10000
          : 0,
      costByAction,
      costByDay: Object.entries(costByDayMap).map(([date, stats]) => ({
        date,
        cost: Math.round(stats.cost * 100) / 100,
        requests: stats.requests,
      })),
    };
  } catch {
    return {
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      avgCostPerRequest: 0,
      costByAction: {},
      costByDay: [],
    };
  }
}

/**
 * Reset daily cost cache (for testing)
 */
export function resetCostCache(): void {
  dailyCosts.clear();
}
