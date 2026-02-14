// ============================================================================
// VetEvidence — DeepResearch 多輪 RAG + 交叉比對 + 證據等級評估
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { getSystemPrompt } from "@/lib/prompts/system";
import { TOOL_DEFINITIONS, executeToolCall } from "@/lib/tools";
import type {
  AgentRequest,
  AgentResponse,
  ToolCallRecord,
  Citation,
} from "./types";

const MAX_DEEP_ROUNDS = 4; // DeepResearch allows more rounds (reduced for Vercel 60s limit)
const DEEP_RESEARCH_MODEL = "claude-sonnet-4-5-20250929";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * DeepResearch — 多輪 RAG 深度研究模式
 *
 * 與普通 Agent Loop 的差異：
 * 1. 允許更多輪 tool 呼叫（8 輪 vs 5 輪）
 * 2. System prompt 加入深度研究指令
 * 3. 要求結構化報告（摘要 + 正文 + 引用 + 局限性）
 * 4. 鼓勵多來源交叉比對
 * 5. 要求標註證據等級
 */
export async function runDeepResearch(
  request: AgentRequest
): Promise<AgentResponse> {
  const startTime = Date.now();
  const allToolCalls: ToolCallRecord[] = [];
  const allCitations: Citation[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const deepResearchPrompt = getDeepResearchPrompt();

  const messages: Anthropic.Messages.MessageParam[] = request.messages.map(
    (m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })
  );

  for (let round = 0; round < MAX_DEEP_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: DEEP_RESEARCH_MODEL,
      max_tokens: 8192, // More tokens for detailed research reports
      system: deepResearchPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const textContent = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      // Extract and deduplicate citations
      extractDeepCitations(allToolCalls, allCitations);

      return {
        content: textContent,
        toolCalls: allToolCalls,
        citations: allCitations,
        tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
        latencyMs: Date.now() - startTime,
      };
    }

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

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }
  }

  // Max rounds exceeded
  return {
    content: "深度研究已達到最大查詢輪次限制。以下是目前收集到的資訊摘要。",
    toolCalls: allToolCalls,
    citations: allCitations,
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: Date.now() - startTime,
  };
}

/** DeepResearch 專用 system prompt */
function getDeepResearchPrompt(): string {
  return `${getSystemPrompt()}

## 🔬 深度研究模式（DeepResearch Mode）

你現在處於**深度研究模式**，需要提供全面、深入的研究報告。

### 深度研究規則
1. **多輪查詢**：你必須使用至少 3 次 search_vet_literature 進行不同角度的查詢
   - 第一輪：主題的基本概述
   - 第二輪：具體治療方案或診斷方法
   - 第三輪：最新研究進展或爭議點
2. **交叉比對**：從不同來源（不同教科書/指引）收集資訊，比較異同
3. **證據等級標註**：為每個建議標註證據等級
   - Level I：系統性回顧/Meta-analysis
   - Level II：隨機對照試驗 (RCT)
   - Level III：非隨機對照研究
   - Level IV：病例系列/專家意見
   - Level V：教科書/臨床經驗
4. **不要重複引用同一段落**：每個引用應包含不同的資訊

### 報告結構（必須遵循）
\`\`\`
## 📋 摘要
- 2-3 句話總結研究結論

## 📖 背景
- 疾病/主題介紹

## 🔬 文獻回顧
- 多來源交叉比對
- 每個論點附上 [N] 引用和證據等級

## 💊 治療建議 / 診斷流程
- 基於證據的具體建議

## ⚠️ 局限性與不確定性
- 現有證據的不足之處
- 需要更多研究的領域

## 📚 引用來源
- 完整引用清單
\`\`\``;
}

/** Extract and deduplicate citations from deep research tool calls */
function extractDeepCitations(
  toolCalls: ToolCallRecord[],
  citations: Citation[]
): void {
  const seenContent = new Set<string>();
  let citationId = 1;

  for (const call of toolCalls) {
    if (call.name === "search_vet_literature" && Array.isArray(call.result)) {
      for (const doc of call.result as Array<Record<string, unknown>>) {
        const content = ((doc.content as string) || "").substring(0, 200);
        const contentKey = content.substring(0, 100); // Dedup key

        if (seenContent.has(contentKey)) continue;
        seenContent.add(contentKey);

        citations.push({
          id: citationId++,
          title: (doc.title as string) || "Unknown",
          source: (doc.source as string) || "Unknown",
          year: doc.year as number | undefined,
          excerpt: content,
          similarity: doc.similarity as number | undefined,
        });
      }
    }
  }
}
