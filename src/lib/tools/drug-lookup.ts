// ============================================================================
// Tool: drug_lookup — 藥物查詢
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import type { DrugInfo, ToolDefinition } from "@/lib/agent/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Tool Schema for Claude API */
export const drugLookupSchema: ToolDefinition = {
  name: "drug_lookup",
  description:
    "查詢獸醫藥物資訊，包含適應症、劑量、禁忌症、交互作用、副作用等。支援中英文藥名搜尋。",
  input_schema: {
    type: "object" as const,
    properties: {
      drug_name: {
        type: "string",
        description: "藥物名稱（通用名或商品名，中英文皆可）",
      },
      species: {
        type: "string",
        enum: ["canine", "feline", "rabbit", "avian", "reptile", "exotic"],
        description: "目標物種（不同物種劑量不同）",
      },
      info_type: {
        type: "string",
        enum: ["full", "dosage", "contraindications", "interactions", "side_effects"],
        description: "需要的資訊類型",
      },
    },
    required: ["drug_name"],
  },
};

/** 執行藥物查詢 — 直接查詢 public.drugs 表 */
export async function drugLookup(input: {
  drug_name: string;
  species?: string;
  info_type?: string;
}): Promise<{ found: boolean; drug_name: string; results: DrugInfo[] }> {
  const { drug_name, species, info_type = "full" } = input;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 直接查詢 public.drugs 表（vet_ai.search_drugs RPC 因 schema 問題不穩定）
    const { data, error } = await supabase
      .from("drugs")
      .select("*")
      .or(`name_en.ilike.%${drug_name}%,name_zh.ilike.%${drug_name}%`)
      .limit(10);

    if (error) {
      console.error("Drug lookup error:", error);
      return { found: false, drug_name, results: [] };
    }

    // 如果 name 搜尋沒結果，嘗試 trade_names 搜尋
    if (!data || data.length === 0) {
      const { data: tradeData, error: tradeError } = await supabase
        .from("drugs")
        .select("*")
        .contains("trade_names", [drug_name])
        .limit(10);

      if (tradeError || !tradeData || tradeData.length === 0) {
        return { found: false, drug_name, results: [] };
      }

      return {
        found: true,
        drug_name,
        results: tradeData.map(mapDrugRow),
      };
    }

    return {
      found: true,
      drug_name,
      results: (data as Record<string, unknown>[]).map(mapDrugRow),
    };
  } catch (err) {
    console.error("drug_lookup error:", err);
    return { found: false, drug_name, results: [] };
  }
}

/** Map DB row to DrugInfo type */
function mapDrugRow(row: Record<string, unknown>): DrugInfo {
  return {
    id: row.id as string,
    nameEn: (row.name_en as string) || "",
    nameZh: (row.name_zh as string) || "",
    classification: (row.classification as string) || "",
    description: (row.description as string) || "",
    mechanism: (row.mechanism as string) || "",
    indications: (row.indications as string[]) || [],
    contraindications: (row.contraindications as string[]) || [],
    sideEffects: (row.side_effects as string[]) || [],
    interactions: (row.interactions as string[]) || [],
    dosageDog: (row.dosage_dog as Record<string, unknown>) || null,
    dosageCat: (row.dosage_cat as Record<string, unknown>) || null,
    warnings: (row.warnings as string[]) || [],
  };
}
