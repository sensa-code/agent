// ============================================================================
// VetEvidence — 英文文獻摘要翻譯
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export interface TranslationResult {
  original: string;
  translated: string;
  language: "zh-TW" | "en";
}

/**
 * Translate English veterinary literature excerpts to Traditional Chinese
 * Uses Claude for context-aware medical translation
 */
export async function translateExcerpt(
  text: string,
  targetLanguage: "zh-TW" | "en" = "zh-TW"
): Promise<TranslationResult> {
  // If already in target language or very short, return as-is
  if (text.length < 10) {
    return { original: text, translated: text, language: targetLanguage };
  }

  // Detect if text is already in Chinese
  const chineseRatio = (text.match(/[\u4e00-\u9fff]/g) || []).length / text.length;
  if (targetLanguage === "zh-TW" && chineseRatio > 0.3) {
    return { original: text, translated: text, language: "zh-TW" };
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: "你是專業的獸醫翻譯。請將以下英文獸醫文獻摘要翻譯成繁體中文。保持醫學術語的準確性，必要時在專有名詞後附上英文原文。只回傳翻譯結果，不要加任何解釋。",
      messages: [
        {
          role: "user",
          content: text,
        },
      ],
    });

    const translated = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      original: text,
      translated: translated || text,
      language: targetLanguage,
    };
  } catch (error) {
    // Fallback: return original text
    console.error("Translation error:", error);
    return { original: text, translated: text, language: targetLanguage };
  }
}

/**
 * Batch translate multiple excerpts
 * Limits concurrency to avoid rate limiting
 */
export async function batchTranslate(
  texts: string[],
  targetLanguage: "zh-TW" | "en" = "zh-TW",
  concurrency: number = 3
): Promise<TranslationResult[]> {
  const results: TranslationResult[] = [];

  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((text) => translateExcerpt(text, targetLanguage))
    );
    results.push(...batchResults);
  }

  return results;
}
