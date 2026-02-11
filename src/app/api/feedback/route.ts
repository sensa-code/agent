// ============================================================================
// VetEvidence — Feedback Collection API
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { submitFeedback, getFeedbackSummary } from "@/lib/feedback/collection";
import type { FeedbackRating } from "@/lib/feedback/collection";

export const runtime = "nodejs";

/**
 * POST /api/feedback — Submit feedback for a message
 *
 * Body:
 *   {
 *     "message_id": "msg-001",
 *     "rating": "thumbs_up" | "thumbs_down",
 *     "comment"?: "很有幫助",
 *     "category"?: "accuracy" | "completeness" | "safety" | "formatting" | "other"
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message_id, rating, comment, category, user_id } = body as {
      message_id?: string;
      rating?: string;
      comment?: string;
      category?: string;
      user_id?: string;
    };

    if (!message_id) {
      return NextResponse.json(
        { error: "message_id is required" },
        { status: 400 }
      );
    }

    if (!rating || !["thumbs_up", "thumbs_down"].includes(rating)) {
      return NextResponse.json(
        { error: 'rating must be "thumbs_up" or "thumbs_down"' },
        { status: 400 }
      );
    }

    const result = await submitFeedback({
      messageId: message_id,
      userId: user_id,
      rating: rating as FeedbackRating,
      comment,
      category: category as
        | "accuracy"
        | "completeness"
        | "safety"
        | "formatting"
        | "other"
        | undefined,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to submit feedback" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      feedback_id: result.id,
    });
  } catch (error) {
    console.error("Feedback API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/feedback — Get feedback summary
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30", 10);

    const summary = await getFeedbackSummary(days);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Feedback summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
