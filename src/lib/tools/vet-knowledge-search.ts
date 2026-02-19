// ============================================================================
// Tool: vet_knowledge_search — 統一知識搜尋
// 融合 VETPRO FTS + RAG 向量 + PubMed 最新文獻
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import { vetproClient, resultMerger } from "@/lib/knowledge";
import type { KnowledgeItem, VetproDiseaseDetail } from "@/lib/knowledge/types";

/** Tool Schema for Claude API */
export const vetKnowledgeSearchSchema: ToolDefinition = {
  name: "vet_knowledge_search",
  description:
    "搜尋獸醫知識(疾病百科/教科書/最新文獻)。query 中英文皆可。回傳融合百科+文獻+期刊的結果含引用。",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "搜尋查詢，如 'canine CKD treatment' 或 '犬慢性腎病'",
      },
      species: {
        type: "string",
        enum: ["dog", "cat", "rabbit", "avian", "reptile", "exotic"],
        description: "物種篩選",
      },
      include_detail: {
        type: "boolean",
        description: "是否取得第一筆疾病的完整資訊(含治療/診斷/預後)，預設 false",
      },
      include_pubmed: {
        type: "boolean",
        description: "是否搜尋 PubMed 最新文獻，預設 false",
      },
    },
    required: ["query"],
  },
};

export interface VetKnowledgeSearchResult {
  query: string;
  totalResults: number;
  results: KnowledgeItem[];
  diseaseDetail?: VetproDiseaseDetail | null;
  sources: string[];
}

/** 執行統一知識搜尋 */
export async function vetKnowledgeSearch(input: {
  query: string;
  species?: string;
  include_detail?: boolean;
  include_pubmed?: boolean;
}): Promise<VetKnowledgeSearchResult> {
  const { query, species, include_detail = false, include_pubmed = false } = input;

  try {
    // 1. 並行查詢 VETPRO + RAG (+ PubMed)
    const mergedResults = await resultMerger.mergeKnowledgeResults(query, {
      species,
      includePubMed: include_pubmed,
      maxResults: 10,
    });

    // 2. 若 include_detail=true 且有 VETPRO 疾病結果，取完整資訊
    let diseaseDetail: VetproDiseaseDetail | null = null;
    if (include_detail && vetproClient.isConfigured()) {
      const firstVetproDisease = mergedResults.find(
        (r) => r.source === "vetpro" && r.slug
      );
      if (firstVetproDisease?.slug) {
        try {
          diseaseDetail = await vetproClient.getDiseaseDetail(firstVetproDisease.slug);
        } catch (err) {
          console.warn("[vet_knowledge_search] Failed to get disease detail:", err);
        }
      }
    }

    // 3. 統計來源
    const sourcesUsed = [...new Set(mergedResults.map((r) => r.source))];

    return {
      query,
      totalResults: mergedResults.length,
      results: mergedResults,
      diseaseDetail: include_detail ? diseaseDetail : undefined,
      sources: sourcesUsed,
    };
  } catch (err) {
    console.error("[vet_knowledge_search] Error:", err);
    return {
      query,
      totalResults: 0,
      results: [],
      sources: [],
    };
  }
}
