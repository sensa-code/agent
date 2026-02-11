// ============================================================================
// VetEvidence — Agent Loop 核心邏輯
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { getSystemPrompt } from "@/lib/prompts/system";
import { TOOL_DEFINITIONS, executeToolCall } from "@/lib/tools";
import type {
  AgentRequest,
  AgentResponse,
  ToolCallRecord,
  Citation,
  TokenUsage,
} from "./types";

const MAX_TOOL_ROUNDS = 5; // 最多 5 輪 tool 呼叫

const anthropic = new Anthropic();

/**
 * Agent Loop — 持續執行直到 Claude 回傳 end_turn
 * 支援多輪 tool_use → tool_result 迴圈
 */
export async function runAgentLoop(
  request: AgentRequest
): Promise<AgentResponse> {
  const startTime = Date.now();
  const allToolCalls: ToolCallRecord[] = [];
  const allCitations: Citation[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  // Build messages for Claude API
  const messages: Anthropic.Messages.MessageParam[] = request.messages.map(
    (m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 4096,
      system: getSystemPrompt(),
      tools: TOOL_DEFINITIONS,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    // If stop_reason is end_turn, extract text and return
    if (response.stop_reason === "end_turn") {
      const textContent = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      // Extract citations from tool results
      extractCitationsFromToolCalls(allToolCalls, allCitations);

      return {
        content: textContent,
        toolCalls: allToolCalls,
        citations: allCitations,
        tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
        latencyMs: Date.now() - startTime,
      };
    }

    // If stop_reason is tool_use, process tool calls
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        const result = await executeToolCall(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        );

        allToolCalls.push({
          name: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
          result,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

      // Append assistant response + tool results to conversation
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }
  }

  // Safety: if we hit MAX_TOOL_ROUNDS, return whatever we have
  return {
    content: "抱歉，處理過程中工具呼叫次數超過上限。請嘗試簡化問題。",
    toolCalls: allToolCalls,
    citations: allCitations,
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Agent Loop with streaming — returns a ReadableStream for SSE
 */
export function runAgentLoopStreaming(
  request: AgentRequest
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      const allToolCalls: ToolCallRecord[] = [];
      const allCitations: Citation[] = [];
      let totalInput = 0;
      let totalOutput = 0;

      const messages: Anthropic.Messages.MessageParam[] = request.messages.map(
        (m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })
      );

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const stream = anthropic.messages.stream({
            model: "claude-sonnet-4-5-20250514",
            max_tokens: 4096,
            system: getSystemPrompt(),
            tools: TOOL_DEFINITIONS,
            messages,
          });

          // Collect the full response for tool handling
          let currentToolUseBlocks: Anthropic.Messages.ToolUseBlock[] = [];
          let isToolUse = false;

          stream.on("text", (text) => {
            // Send text deltas as SSE events
            const event = `data: ${JSON.stringify({ type: "text_delta", data: text })}\n\n`;
            controller.enqueue(encoder.encode(event));
          });

          const finalMessage = await stream.finalMessage();

          totalInput += finalMessage.usage.input_tokens;
          totalOutput += finalMessage.usage.output_tokens;

          if (finalMessage.stop_reason === "end_turn") {
            // Extract citations and send them
            extractCitationsFromToolCalls(allToolCalls, allCitations);
            if (allCitations.length > 0) {
              const citationEvent = `data: ${JSON.stringify({ type: "citations", data: allCitations })}\n\n`;
              controller.enqueue(encoder.encode(citationEvent));
            }

            // Send tool calls summary
            if (allToolCalls.length > 0) {
              const toolEvent = `data: ${JSON.stringify({ type: "tool_calls", data: allToolCalls.map((t) => ({ name: t.name, input: t.input })) })}\n\n`;
              controller.enqueue(encoder.encode(toolEvent));
            }

            // Send done event
            const doneEvent = `data: ${JSON.stringify({
              type: "done",
              data: {
                toolCalls: allToolCalls.map((t) => ({ name: t.name, input: t.input })),
                citations: allCitations,
                tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
                latencyMs: Date.now() - startTime,
              },
            })}\n\n`;
            controller.enqueue(encoder.encode(doneEvent));
            controller.close();
            return;
          }

          // Handle tool_use
          if (finalMessage.stop_reason === "tool_use") {
            currentToolUseBlocks = finalMessage.content.filter(
              (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
            );

            // Notify client about tool calls
            for (const toolBlock of currentToolUseBlocks) {
              const toolNotify = `data: ${JSON.stringify({ type: "tool_call", data: { name: toolBlock.name, input: toolBlock.input } })}\n\n`;
              controller.enqueue(encoder.encode(toolNotify));
            }

            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

            for (const toolBlock of currentToolUseBlocks) {
              const result = await executeToolCall(
                toolBlock.name,
                toolBlock.input as Record<string, unknown>
              );

              allToolCalls.push({
                name: toolBlock.name,
                input: toolBlock.input as Record<string, unknown>,
                result,
              });

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: JSON.stringify(result),
              });
            }

            messages.push({ role: "assistant", content: finalMessage.content });
            messages.push({ role: "user", content: toolResults });
          }
        }

        // Max rounds exceeded
        const errorEvent = `data: ${JSON.stringify({ type: "error", data: "Tool call rounds exceeded" })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      } catch (err) {
        const errorEvent = `data: ${JSON.stringify({ type: "error", data: String(err) })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      }
    },
  });
}

/** Extract citations from RAG tool results */
function extractCitationsFromToolCalls(
  toolCalls: ToolCallRecord[],
  citations: Citation[]
): void {
  for (const call of toolCalls) {
    if (call.name === "search_vet_literature" && Array.isArray(call.result)) {
      for (const doc of call.result as Array<Record<string, unknown>>) {
        citations.push({
          id: doc.id as number,
          title: (doc.title as string) || "Unknown",
          source: (doc.source as string) || "Unknown",
          year: doc.year as number | undefined,
          excerpt: ((doc.content as string) || "").substring(0, 200),
          similarity: doc.similarity as number | undefined,
        });
      }
    }
  }
}
