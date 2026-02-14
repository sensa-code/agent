// ============================================================================
// VetEvidence — 圖片分析（X-ray, 血檢報告）
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { getSystemPrompt } from "@/lib/prompts/system";
import { TOOL_DEFINITIONS, executeToolCall } from "@/lib/tools";
import type {
  AgentResponse,
  ToolCallRecord,
  Citation,
} from "./types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ImageAnalysisRequest {
  imageData: string;        // base64 encoded
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  prompt: string;           // User's question about the image
  conversationId?: string;
  userId?: string;
}

/**
 * Analyze veterinary medical images using Claude Vision
 *
 * Supported image types:
 * - X-ray (thorax, abdominal, orthopedic)
 * - Lab reports (CBC, blood chemistry, urinalysis)
 * - Dermatology photos
 * - Cytology/histopathology (basic interpretation)
 */
export async function analyzeImage(
  request: ImageAnalysisRequest
): Promise<AgentResponse> {
  const startTime = Date.now();
  const allToolCalls: ToolCallRecord[] = [];
  const allCitations: Citation[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const imagePrompt = getImageAnalysisPrompt();

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: request.mediaType,
            data: request.imageData,
          },
        },
        {
          type: "text",
          text: request.prompt,
        },
      ],
    },
  ];

  // Image analysis typically needs 1-2 rounds (analyze → search literature for context)
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: imagePrompt,
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

  return {
    content: "圖片分析已完成，但達到處理上限。",
    toolCalls: allToolCalls,
    citations: allCitations,
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: Date.now() - startTime,
  };
}

/** Image analysis specific system prompt */
function getImageAnalysisPrompt(): string {
  return `${getSystemPrompt()}

## 🖼️ 圖片分析模式

你現在處於**圖片分析模式**，需要分析獸醫醫學影像或實驗室報告。

### 分析規則
1. **辨識圖片類型**：首先判斷圖片是 X-ray、超音波、血檢報告、皮膚照片還是其他
2. **結構化描述**：使用醫學術語系統性描述所見
3. **非醫學圖片**：如果圖片不是醫學影像或實驗室報告，明確告知使用者這不是醫學圖片，無法進行臨床判讀
4. **搜尋文獻**：分析後使用 search_vet_literature 搜尋相關文獻佐證
5. **免責聲明**：**每次分析必須附上免責聲明**

### X-ray 分析格式
\`\`\`
## 影像類型
[X-ray / 超音波 / 其他]

## 系統性判讀
- 軟組織：
- 骨骼結構：
- 器官輪廓：
- 異常發現：

## 鑑別診斷
1. 最可能：
2. 次可能：
3. 需排除：

## 建議後續檢查
-

## ⚠️ 免責聲明
本分析僅供參考，不能替代專業獸醫放射科醫師的判讀。建議將影像送交獸醫影像專科醫師進行正式報告。
\`\`\`

### 血檢報告分析格式
\`\`\`
## 報告類型
[CBC / 血液生化 / 尿液分析 / 其他]

## 異常數值
| 項目 | 數值 | 參考範圍 | 判讀 |
|------|------|---------|------|

## 綜合評估
-

## 建議後續檢查
-

## ⚠️ 免責聲明
本分析僅供參考，請以您的臨床判斷為主。建議與臨床病史和理學檢查結合判讀。
\`\`\``;
}
