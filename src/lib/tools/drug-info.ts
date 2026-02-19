// ============================================================================
// Tool: drug_info — 統一藥物查詢
// 融合 VETPRO drugs (886+) + RAG 文獻 + 交互作用檢查
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import { vetproClient, ragClient } from "@/lib/knowledge";
import type {
  VetproDrugDetail,
  VetproInteraction,
  KnowledgeItem,
} from "@/lib/knowledge/types";

/** Tool Schema for Claude API */
export const drugInfoSchema: ToolDefinition = {
  name: "drug_info",
  description:
    "查詢獸醫藥物(劑量/適應症/禁忌/交互作用/不良反應)。支援中英文藥名/商品名。可同時查交互作用。",
  input_schema: {
    type: "object" as const,
    properties: {
      drug_name: {
        type: "string",
        description: "藥物名稱(中英文/商品名皆可)",
      },
      species: {
        type: "string",
        enum: ["dog", "cat", "rabbit", "avian", "reptile", "exotic"],
        description: "目標物種(篩選劑量)",
      },
      check_interactions: {
        type: "array",
        items: { type: "string" },
        description: "同時用藥名單(藥名列表)，自動查交互作用",
      },
    },
    required: ["drug_name"],
  },
};

export interface DrugInfoResult {
  found: boolean;
  drugName: string;
  /** 主要藥物詳情（VETPRO） */
  drugDetail?: VetproDrugDetail | null;
  /** 藥物交互作用 */
  interactions?: VetproInteraction[];
  /** RAG 補充文獻（VETPRO 無結果時） */
  ragResults?: KnowledgeItem[];
  sources: string[];
}

/** 執行統一藥物查詢 */
export async function drugInfo(input: {
  drug_name: string;
  species?: string;
  check_interactions?: string[];
}): Promise<DrugInfoResult> {
  const { drug_name, species, check_interactions } = input;
  const sources: string[] = [];

  try {
    // 1. VETPRO 藥物搜尋
    let drugDetail: VetproDrugDetail | null = null;
    let allDrugIds: Map<string, string> = new Map(); // drugName → drugId

    if (vetproClient.isConfigured()) {
      try {
        const searchResult = await vetproClient.searchDrugs(drug_name, { species });

        if (searchResult.drugs && searchResult.drugs.length > 0) {
          sources.push("vetpro");

          // Get the first match's full detail
          const firstMatch = searchResult.drugs[0];
          drugDetail = await vetproClient.getDrugDetail(firstMatch.slug);

          // Build drug ID map for interaction checking
          for (const d of searchResult.drugs) {
            allDrugIds.set(d.nameEn.toLowerCase(), d.id);
            if (d.nameZh) allDrugIds.set(d.nameZh.toLowerCase(), d.id);
          }
        }
      } catch (err) {
        console.warn("[drug_info] VETPRO drug search failed:", err);
      }
    }

    // 2. 交互作用查詢
    let interactions: VetproInteraction[] = [];
    if (check_interactions && check_interactions.length > 0 && vetproClient.isConfigured()) {
      try {
        // Resolve drug names to IDs
        const interactionDrugIds: string[] = [];

        // Add the main drug's ID
        if (drugDetail?.id) {
          interactionDrugIds.push(drugDetail.id);
        }

        // Resolve each interaction drug name
        for (const name of check_interactions) {
          // Check if we already have the ID
          const cachedId = allDrugIds.get(name.toLowerCase());
          if (cachedId) {
            interactionDrugIds.push(cachedId);
            continue;
          }

          // Search for the drug to get its ID
          try {
            const result = await vetproClient.searchDrugs(name);
            if (result.drugs && result.drugs.length > 0) {
              interactionDrugIds.push(result.drugs[0].id);
              allDrugIds.set(name.toLowerCase(), result.drugs[0].id);
            }
          } catch {
            // Skip unresolvable drug names
          }
        }

        // Check interactions if we have at least 2 drug IDs
        const uniqueIds = [...new Set(interactionDrugIds)];
        if (uniqueIds.length >= 2) {
          const interactionResult = await vetproClient.checkInteractions(uniqueIds);
          interactions = interactionResult.interactions || [];
        }
      } catch (err) {
        console.warn("[drug_info] Interaction check failed:", err);
      }
    }

    // 3. RAG fallback (if VETPRO found nothing)
    let ragResults: KnowledgeItem[] = [];
    if (!drugDetail && ragClient.isConfigured()) {
      try {
        ragResults = await ragClient.search(
          `${drug_name} veterinary pharmacology dosage`,
          { maxResults: 3 }
        );
        if (ragResults.length > 0) {
          sources.push("rag");
        }
      } catch (err) {
        console.warn("[drug_info] RAG fallback failed:", err);
      }
    }

    return {
      found: Boolean(drugDetail || ragResults.length > 0),
      drugName: drug_name,
      drugDetail,
      interactions: interactions.length > 0 ? interactions : undefined,
      ragResults: ragResults.length > 0 ? ragResults : undefined,
      sources,
    };
  } catch (err) {
    console.error("[drug_info] Error:", err);
    return {
      found: false,
      drugName: drug_name,
      sources: [],
    };
  }
}
