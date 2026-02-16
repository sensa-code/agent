// ============================================================================
// VetEvidence — Agent Loop 核心邏輯
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { getSystemPromptWithContext } from "@/lib/prompts/system";
import { TOOL_DEFINITIONS, executeToolCall } from "@/lib/tools";
import type {
  AgentRequest,
  AgentResponse,
  ToolCallRecord,
  Citation,
  TokenUsage,
} from "./types";

const MAX_TOOL_ROUNDS = 5; // 最多 5 輪 tool 呼叫（需確保最後一輪能 end_turn）
const FAST_MODE_TOOL_ROUNDS = 1; // hospitalization_summary / soap_structure 僅 1 輪工具（已有充足上下文）
const MAX_TOOL_RESULT_CHARS = 2000; // Tool result 截斷上限（節省 token）
const MAX_PREV_TOOL_RESULT_CHARS = 1000; // 前輪 tool result 截斷上限（conversation history 節省）

// 模型選擇：Fast mode (SOAP/住院摘要) 用 Haiku — 1/3 價格、4-5x 速度，解決 timeout
const MODEL_SONNET = "claude-sonnet-4-5-20250929";
const MODEL_HAIKU = "claude-haiku-4-5-20251001";

/** 截斷 tool result 字串，避免超大 JSON 消耗 token */
function truncateToolResult(result: unknown, maxChars: number = MAX_TOOL_RESULT_CHARS): string {
  const json = JSON.stringify(result);
  if (json.length <= maxChars) return json;
  return json.substring(0, maxChars) + `...[truncated, ${json.length} total chars]`;
}

/** 截斷前輪 messages 中的 tool_result，降低 conversation history token 消耗 */
function truncatePreviousToolResults(
  messages: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
  return messages.map((msg, idx) => {
    // 只截斷非最後一輪的 user messages（tool_result 以 user role 發送）
    if (msg.role !== "user" || idx >= messages.length - 2) return msg;
    if (!Array.isArray(msg.content)) return msg;

    const truncated = msg.content.map((block) => {
      if (typeof block === "object" && block !== null && "type" in block) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ContentBlockParam union 需要 any 判斷
        const anyBlock = block as any;
        if (anyBlock.type === "tool_result") {
          const tb = block as Anthropic.Messages.ToolResultBlockParam;
          const content = typeof tb.content === "string" ? tb.content : JSON.stringify(tb.content);
          if (content.length > MAX_PREV_TOOL_RESULT_CHARS) {
            return {
              ...tb,
              content: content.substring(0, MAX_PREV_TOOL_RESULT_CHARS) + "...[truncated]",
            };
          }
        }
      }
      return block;
    });

    return { ...msg, content: truncated } as Anthropic.Messages.MessageParam;
  });
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

  // Build system prompt with patient context (if provided by EMR)
  const systemPrompt = getSystemPromptWithContext(
    request.context,
    request.mode
  );

  // Build messages for Claude API
  const messages: Anthropic.Messages.MessageParam[] = request.messages.map(
    (m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })
  );

  // 住院摘要和 SOAP 結構化已有充足上下文，減少工具輪次避免 Vercel timeout
  const isFastMode = request.mode === 'hospitalization_summary' || request.mode === 'soap_structure';
  const maxRounds = isFastMode ? FAST_MODE_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
  // Fast mode 不提供工具（上下文已足夠），節省 token 和時間
  const tools = isFastMode ? undefined : TOOL_DEFINITIONS;
  // Fast mode 用 Haiku（更快更便宜），一般模式用 Sonnet（更強推理）
  const model = isFastMode ? MODEL_HAIKU : MODEL_SONNET;

  for (let round = 0; round < maxRounds; round++) {
    // 截斷前輪 tool results，降低 conversation history token 消耗
    const optimizedMessages = round > 0 ? truncatePreviousToolResults(messages) : messages;

    // 首輪強制使用工具（tool_choice: any），後續輪次由 Claude 自行決定
    const toolChoice = (tools && round === 0) ? { type: "any" as const } : undefined;

    // 最後一輪或已超過 40 秒：不提供工具，強制 Claude 產生最終回覆
    const elapsedMs = Date.now() - startTime;
    const isLastRound = round === maxRounds - 1;
    const isTimeConstrained = elapsedMs > 40_000;
    const roundTools = (isLastRound || isTimeConstrained) ? undefined : tools;

    // Fast mode (SOAP/住院摘要) 需要更多 output tokens（中文 + JSON 結構較長）
    const maxTokens = isFastMode ? 8192 : 4096;

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      ...(roundTools ? { tools: roundTools, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}),
      messages: optimizedMessages,
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
          content: truncateToolResult(result),
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

      // Build system prompt with patient context (if provided by EMR)
      const systemPrompt = getSystemPromptWithContext(
        request.context,
        request.mode
      );

      const messages: Anthropic.Messages.MessageParam[] = request.messages.map(
        (m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })
      );

      // Fast mode: SOAP/住院摘要已有充足上下文，不需要工具，減少輪次
      const isFastMode = request.mode === 'hospitalization_summary' || request.mode === 'soap_structure';
      const maxRounds = isFastMode ? FAST_MODE_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
      const streamTools = isFastMode ? undefined : TOOL_DEFINITIONS;
      // Fast mode 用 Haiku（更快更便宜），一般模式用 Sonnet（更強推理）
      const model = isFastMode ? MODEL_HAIKU : MODEL_SONNET;

      try {
        for (let round = 0; round < maxRounds; round++) {
          // 截斷前輪 tool results，降低 conversation history token 消耗
          const optimizedMessages = round > 0 ? truncatePreviousToolResults(messages) : messages;

          // 首輪強制使用工具（tool_choice: any），後續輪次由 Claude 自行決定
          const streamToolChoice = (streamTools && round === 0) ? { type: "any" as const } : undefined;

          // 最後一輪或已超過 40 秒：不提供工具，強制 Claude 產生最終回覆
          const streamElapsedMs = Date.now() - startTime;
          const isStreamLastRound = round === maxRounds - 1;
          const isStreamTimeConstrained = streamElapsedMs > 40_000;
          const roundStreamTools = (isStreamLastRound || isStreamTimeConstrained) ? undefined : streamTools;

          const streamMaxTokens = isFastMode ? 8192 : 4096;

          const stream = anthropic.messages.stream({
            model,
            max_tokens: streamMaxTokens,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            ...(roundStreamTools ? { tools: roundStreamTools, ...(streamToolChoice ? { tool_choice: streamToolChoice } : {}) } : {}),
            messages: optimizedMessages,
          });

          // Collect the full response for tool handling
          let currentToolUseBlocks: Anthropic.Messages.ToolUseBlock[] = [];
          const isToolUse = false;

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
                content: truncateToolResult(result),
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
