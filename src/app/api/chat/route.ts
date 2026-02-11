// ============================================================================
// VetEvidence — /api/chat Streaming Endpoint
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { runAgentLoop, runAgentLoopStreaming } from "@/lib/agent/loop";
import { runDeepResearch } from "@/lib/agent/deep-research";
import { analyzeImage } from "@/lib/agent/image-analysis";
import type { ChatMessage } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 120; // 120 second timeout (deep research needs more time)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, stream = true, mode = "chat", image } = body as {
      messages: ChatMessage[];
      stream?: boolean;
      mode?: "chat" | "deep_research" | "image_analysis";
      image?: { data: string; media_type: string };
    };

    // Validate input
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        return NextResponse.json(
          { error: "Each message must have role and content" },
          { status: 400 }
        );
      }
    }

    // Input length guard
    const totalLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalLength > 50000) {
      return NextResponse.json(
        { error: "Input too long. Maximum total length is 50000 characters." },
        { status: 400 }
      );
    }

    // Route to appropriate handler based on mode
    if (mode === "deep_research") {
      const result = await runDeepResearch({ messages });
      return NextResponse.json({
        content: result.content,
        tool_calls: result.toolCalls.map((t) => ({
          name: t.name,
          input: t.input,
        })),
        citations: result.citations,
        token_usage: result.tokenUsage,
        latency_ms: result.latencyMs,
        mode: "deep_research",
      });
    }

    if (mode === "image_analysis" && image) {
      const result = await analyzeImage({
        imageData: image.data,
        mediaType: image.media_type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        prompt: messages[messages.length - 1].content,
      });
      return NextResponse.json({
        content: result.content,
        tool_calls: result.toolCalls.map((t) => ({
          name: t.name,
          input: t.input,
        })),
        citations: result.citations,
        token_usage: result.tokenUsage,
        latency_ms: result.latencyMs,
        mode: "image_analysis",
      });
    }

    // Standard chat mode
    if (stream) {
      // Streaming response (SSE)
      const readableStream = runAgentLoopStreaming({ messages });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // Non-streaming response (JSON)
      const result = await runAgentLoop({ messages });

      return NextResponse.json({
        content: result.content,
        tool_calls: result.toolCalls.map((t) => ({
          name: t.name,
          input: t.input,
        })),
        citations: result.citations,
        token_usage: result.tokenUsage,
        latency_ms: result.latencyMs,
      });
    }
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
