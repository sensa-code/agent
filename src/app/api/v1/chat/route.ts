// ============================================================================
// VetEvidence — External REST API: /api/v1/chat
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  validateApiKeyWithTestSupport,
  checkApiKeyRateLimit,
} from "@/lib/api/api-key-manager";
import { runAgentLoop } from "@/lib/agent/loop";
import { checkUsageLimit, incrementUsage } from "@/lib/billing/usage-tracker";
import { calculateCost, trackCost } from "@/lib/monitoring/cost-tracker";
import { evaluateAnswerQuality } from "@/lib/monitoring/quality-score";
import type { ChatMessage, PatientContext, AIMode } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/chat — External API for chat queries
 *
 * Headers:
 *   Authorization: Bearer vk_live_xxxxx
 *
 * Body:
 *   { "message": "犬腎病治療建議", "species"?: "canine" }
 *
 * Response:
 *   { "answer": "...", "citations": [...], "model": "...", "usage": {...} }
 */
export async function POST(request: NextRequest) {
  try {
    // ── 1. Extract API key ──
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const apiKey = authHeader.replace("Bearer ", "").trim();

    // ── 2. Validate API key ──
    const validation = await validateApiKeyWithTestSupport(apiKey);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid API key" },
        { status: 401 }
      );
    }

    // ── 3. Check rate limit ──
    const rateCheck = checkApiKeyRateLimit(
      validation.keyId!,
      validation.rateLimit || 10
    );
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          retry_after_sec: rateCheck.retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateCheck.retryAfterSec || 60),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    // ── 4. Check usage limit ──
    const usageCheck = await checkUsageLimit(validation.userId!, "chat");
    if (!usageCheck.allowed) {
      return NextResponse.json(
        {
          error:
            usageCheck.upgradeMessage ||
            "您已達到每日使用上限。升級至專業版享受更多查詢次數！upgrade to Pro for unlimited access.",
        },
        { status: 429 }
      );
    }

    // ── 5. Parse request body ──
    const body = await request.json();
    const { message, species, context, mode } = body as {
      message?: string;
      species?: string;
      context?: PatientContext;
      mode?: AIMode;
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message field is required" },
        { status: 400 }
      );
    }

    // ── 6. Build messages and run agent ──
    // 將 species 前綴加在 user message（向下相容）
    const messages: ChatMessage[] = [
      { role: "user", content: species ? `[物種: ${species}] ${message}` : message },
    ];

    const result = await runAgentLoop({
      messages,
      userId: validation.userId,
      context: context || undefined,
      mode: mode || undefined,
    });

    // ── 7. Track usage and cost ──
    const totalTokens =
      result.tokenUsage.inputTokens + result.tokenUsage.outputTokens;
    const cost = calculateCost(
      "claude-sonnet-4-5-20250929",
      result.tokenUsage.inputTokens,
      result.tokenUsage.outputTokens
    );

    // Non-blocking tracking
    incrementUsage(validation.userId!, "chat", totalTokens).catch(() => {});
    trackCost({
      messageId: `api_${Date.now()}`,
      userId: validation.userId!,
      model: "claude-sonnet-4-5-20250929",
      inputTokens: result.tokenUsage.inputTokens,
      outputTokens: result.tokenUsage.outputTokens,
      costUsd: cost,
      action: "v1_chat",
      timestamp: new Date(),
    }).catch(() => {});

    // ── 8. Quality score ──
    const quality = evaluateAnswerQuality(
      result.content,
      result.citations.map((c) => ({ id: c.id, valid: true })),
      result.toolCalls.map((t) => ({ name: t.name }))
    );

    // ── 9. Return response ──
    return NextResponse.json(
      {
        answer: result.content,
        citations: result.citations.map((c) => ({
          id: c.id,
          title: c.title,
          source: c.source,
          year: c.year,
        })),
        model: "claude-sonnet-4-5-20250929",
        usage: {
          input_tokens: result.tokenUsage.inputTokens,
          output_tokens: result.tokenUsage.outputTokens,
          total_tokens: totalTokens,
          cost_usd: cost,
        },
        quality_score: quality.overall,
        latency_ms: result.latencyMs,
        // Debug: tool calls info
        _debug_tool_calls: result.toolCalls.map(tc => ({
          name: tc.name,
          resultIsArray: Array.isArray(tc.result),
          resultLength: Array.isArray(tc.result) ? tc.result.length : typeof tc.result,
        })),
        _debug_citations_count: result.citations.length,
      },
      {
        headers: {
          "X-RateLimit-Remaining": String(rateCheck.remaining),
        },
      }
    );
  } catch (error) {
    console.error("API v1 chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
