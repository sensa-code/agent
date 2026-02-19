// ============================================================================
// Tool: differential_diagnosis — 統一鑑別診斷
// Primary: VETPRO DDX Engine (2563 diseases, 206 symptoms, 55 labs)
// Fallback: Hardcoded DIFFERENTIAL_DB (26 conditions) + RAG 搜尋
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import { vetproClient, ragClient } from "@/lib/knowledge";
import type { VetproDDXResult, KnowledgeItem } from "@/lib/knowledge/types";

/** Tool Schema for Claude API */
export const differentialDiagnosisSchema: ToolDefinition = {
  name: "differential_diagnosis",
  description:
    "依症狀/Lab數據/物種生成鑑別診斷排名。2563疾病庫，症狀+Lab複合評分。",
  input_schema: {
    type: "object" as const,
    properties: {
      symptoms: {
        type: "array",
        items: { type: "string" },
        description: "症狀列表(英文自由文字)，如 ['vomiting','diarrhoea','lethargy']。自動解析為標準症狀 ID。",
      },
      labs: {
        type: "array",
        items: { type: "string" },
        description: "實驗室異常(英文自由文字)，如 ['azotaemia','hyperkalaemia']。選填。",
      },
      species: {
        type: "string",
        enum: ["dog", "cat", "rabbit", "avian", "reptile", "exotic"],
        description: "物種",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "排除具有這些症狀的疾病(選填)",
      },
    },
    required: ["symptoms"],
  },
};

export interface UnifiedDDXResult {
  /** VETPRO DDX 排名結果 */
  differentials: Array<{
    slug: string;
    nameEn: string;
    nameZh: string | null;
    bodySystem: string;
    description: string | null;
    compositeScore: number;
    urgencyScore: number;
    matchedSymptoms: string[];
    matchedLabs: string[];
    species: string[];
  }>;
  /** 查詢資訊 */
  resolvedSymptoms: Array<{ input: string; id: string | null; name: string | null }>;
  resolvedLabs: Array<{ input: string; id: string | null; name: string | null }>;
  species: string;
  totalResults: number;
  source: "vetpro" | "fallback";
  /** RAG 補充（VETPRO 失敗時） */
  ragSupplements?: KnowledgeItem[];
  notes: string[];
}

// ─── Species name normalization ───

function normalizeSpecies(species?: string): string | undefined {
  const map: Record<string, string> = {
    canine: "dog",
    feline: "cat",
    dog: "dog",
    cat: "cat",
    rabbit: "rabbit",
    avian: "avian",
    reptile: "reptile",
    exotic: "exotic",
  };
  return species ? map[species.toLowerCase()] || species : undefined;
}

// ─── Symptom/Lab ID Resolution ───

async function resolveSymptomIds(
  symptoms: string[]
): Promise<Array<{ input: string; id: string | null; name: string | null }>> {
  const results: Array<{ input: string; id: string | null; name: string | null }> = [];

  for (const symptom of symptoms) {
    try {
      const matches = await vetproClient.searchSymptoms(symptom);
      if (matches.length > 0) {
        results.push({ input: symptom, id: matches[0].id, name: matches[0].enName });
      } else {
        results.push({ input: symptom, id: null, name: null });
      }
    } catch {
      results.push({ input: symptom, id: null, name: null });
    }
  }

  return results;
}

async function resolveLabIds(
  labs: string[]
): Promise<Array<{ input: string; id: string | null; name: string | null }>> {
  const results: Array<{ input: string; id: string | null; name: string | null }> = [];

  for (const lab of labs) {
    try {
      const matches = await vetproClient.searchLabFindings(lab);
      if (matches.length > 0) {
        results.push({ input: lab, id: matches[0].id, name: matches[0].enName });
      } else {
        results.push({ input: lab, id: null, name: null });
      }
    } catch {
      results.push({ input: lab, id: null, name: null });
    }
  }

  return results;
}

// ─── Main DDX function ───

/** 生成統一鑑別診斷 */
export async function generateDifferentialDiagnosis(input: {
  symptoms: string[];
  species?: string;
  labs?: string[];
  exclude?: string[];
}): Promise<UnifiedDDXResult> {
  const { symptoms, labs = [], exclude = [] } = input;
  const species = normalizeSpecies(input.species) || "both";
  const notes: string[] = [];

  // ─── Try VETPRO DDX Engine (primary) ───
  if (vetproClient.isConfigured()) {
    try {
      // 1. Resolve symptom names → standard IDs (parallel)
      const [resolvedSymptoms, resolvedLabs] = await Promise.all([
        resolveSymptomIds(symptoms),
        labs.length > 0 ? resolveLabIds(labs) : Promise.resolve([]),
      ]);

      const symptomIds = resolvedSymptoms.filter((r) => r.id).map((r) => r.id!);
      const labIds = resolvedLabs.filter((r) => r.id).map((r) => r.id!);

      // Warn about unresolved inputs
      const unresolvedSymptoms = resolvedSymptoms.filter((r) => !r.id);
      const unresolvedLabs = resolvedLabs.filter((r) => !r.id);
      if (unresolvedSymptoms.length > 0) {
        notes.push(`以下症狀未在百科中找到匹配：${unresolvedSymptoms.map((r) => r.input).join(", ")}`);
      }
      if (unresolvedLabs.length > 0) {
        notes.push(`以下 Lab 項目未在百科中找到匹配：${unresolvedLabs.map((r) => r.input).join(", ")}`);
      }

      if (symptomIds.length === 0 && labIds.length === 0) {
        notes.push("所有輸入症狀/Lab 均無法解析，使用 RAG 文獻搜尋補充");
        // Fall through to fallback
      } else {
        // 2. Resolve exclude symptoms
        let excludeIds: string[] = [];
        if (exclude.length > 0) {
          const resolvedExclude = await resolveSymptomIds(exclude);
          excludeIds = resolvedExclude.filter((r) => r.id).map((r) => r.id!);
        }

        // 3. Call VETPRO DDX
        const ddxResult = await vetproClient.getDDX(symptomIds, labIds, {
          species: species !== "both" ? species : undefined,
          exclude: excludeIds.length > 0 ? excludeIds : undefined,
        });

        return {
          differentials: (ddxResult.results || []).slice(0, 20).map((r: VetproDDXResult) => ({
            slug: r.slug,
            nameEn: r.nameEn,
            nameZh: r.nameZh,
            bodySystem: r.bodySystem,
            description: r.description,
            compositeScore: r.compositeScore,
            urgencyScore: r.urgencyScore,
            matchedSymptoms: r.matchedSymptoms,
            matchedLabs: r.matchedLabs,
            species: r.species,
          })),
          resolvedSymptoms,
          resolvedLabs,
          species,
          totalResults: ddxResult.resultCount,
          source: "vetpro",
          notes,
        };
      }
    } catch (err) {
      console.warn("[differential_diagnosis] VETPRO DDX failed, using fallback:", err);
      notes.push("百科 DDX 引擎暫時不可用，使用基礎鑑別資料庫");
    }
  }

  // ─── Fallback: hardcoded DB + RAG ───
  const fallbackResult = generateFallbackDDX(symptoms, species, input);

  // Also try RAG for supplemental info
  let ragSupplements: KnowledgeItem[] = [];
  if (ragClient.isConfigured()) {
    try {
      ragSupplements = await ragClient.search(
        `${symptoms.join(" ")} differential diagnosis ${species}`,
        { maxResults: 3 }
      );
    } catch {
      // Ignore RAG failures in fallback
    }
  }

  return {
    differentials: fallbackResult.differentials.map((d) => ({
      slug: "",
      nameEn: d.condition,
      nameZh: d.condition_zh,
      bodySystem: "",
      description: null,
      compositeScore: d.likelihood === "high" ? 3 : d.likelihood === "moderate" ? 2 : 1,
      urgencyScore: d.urgency === "emergency" ? 4 : d.urgency === "urgent" ? 3 : 1,
      matchedSymptoms: symptoms,
      matchedLabs: [],
      species: [species],
    })),
    resolvedSymptoms: symptoms.map((s) => ({ input: s, id: null, name: null })),
    resolvedLabs: [],
    species,
    totalResults: fallbackResult.differentials.length,
    source: "fallback",
    ragSupplements: ragSupplements.length > 0 ? ragSupplements : undefined,
    notes: [...notes, ...fallbackResult.notes],
  };
}

// ─── Fallback: Original hardcoded DB ───

interface DiffEntry {
  condition: string;
  condition_zh: string;
  likelihood: "high" | "moderate" | "low";
  urgency: "emergency" | "urgent" | "routine";
  key_features: string[];
  tests: string[];
  sex_filter?: string[];
  age_filter?: { min?: number; max?: number };
  breed_risk?: string[];
}

const DIFFERENTIAL_DB: Record<string, Record<string, DiffEntry[]>> = {
  dog: {
    "polyuria,polydipsia": [
      { condition: "Pyometra", condition_zh: "子宮蓄膿", likelihood: "high", urgency: "emergency", sex_filter: ["female_intact"], key_features: ["Intact female", "vaginal discharge", "lethargy"], tests: ["CBC", "Abdominal ultrasound", "Progesterone"] },
      { condition: "Diabetes mellitus", condition_zh: "糖尿病", likelihood: "high", urgency: "urgent", key_features: ["Hyperglycemia", "glucosuria", "weight loss"], tests: ["Blood glucose", "Fructosamine", "Urinalysis"] },
      { condition: "Hyperadrenocorticism (Cushing's)", condition_zh: "庫欣氏症", likelihood: "high", urgency: "routine", key_features: ["Pot-bellied appearance", "skin changes", "panting"], tests: ["LDDS test", "ACTH stimulation", "Abdominal ultrasound"] },
      { condition: "Chronic kidney disease", condition_zh: "慢性腎病", likelihood: "high", urgency: "urgent", key_features: ["Azotemia", "isosthenuria", "weight loss"], tests: ["Creatinine", "SDMA", "Urinalysis with UPC"] },
    ],
    "vomiting": [
      { condition: "Foreign body obstruction", condition_zh: "異物阻塞", likelihood: "high", urgency: "emergency", key_features: ["Acute onset", "nonproductive retching", "abdominal pain"], tests: ["Abdominal radiographs", "Barium study", "Ultrasound"] },
      { condition: "Pancreatitis", condition_zh: "胰臟炎", likelihood: "high", urgency: "urgent", key_features: ["Abdominal pain", "anorexia", "diarrhea"], tests: ["cPLI/SNAP cPL", "Ultrasound", "CBC"] },
      { condition: "Gastritis", condition_zh: "胃炎", likelihood: "high", urgency: "routine", key_features: ["Dietary indiscretion", "self-limiting"], tests: ["Symptomatic treatment trial"] },
    ],
  },
  cat: {
    "vomiting": [
      { condition: "Inflammatory bowel disease (IBD)", condition_zh: "炎症性腸病", likelihood: "high", urgency: "routine", key_features: ["Chronic intermittent", "weight loss"], tests: ["Cobalamin/Folate", "Abdominal ultrasound", "Endoscopy + biopsy"] },
      { condition: "Pancreatitis", condition_zh: "胰臟炎", likelihood: "high", urgency: "urgent", key_features: ["Anorexia", "lethargy"], tests: ["fPLI/SNAP fPL", "Ultrasound"] },
    ],
    "polyuria,polydipsia": [
      { condition: "Chronic kidney disease", condition_zh: "慢性腎病", likelihood: "high", urgency: "urgent", key_features: ["Older cat", "weight loss", "azotemia"], tests: ["Creatinine", "SDMA", "UPC", "Urinalysis"] },
      { condition: "Diabetes mellitus", condition_zh: "糖尿病", likelihood: "high", urgency: "urgent", key_features: ["Overweight cat", "plantigrade stance", "hyperglycemia"], tests: ["Blood glucose", "Fructosamine", "Urinalysis"] },
      { condition: "Hyperthyroidism", condition_zh: "甲狀腺功能亢進", likelihood: "high", urgency: "routine", key_features: ["Older cat", "weight loss", "tachycardia"], tests: ["Total T4", "Free T4"] },
    ],
  },
};

function generateFallbackDDX(
  symptoms: string[],
  species: string,
  input: Record<string, unknown>
): {
  differentials: Array<{
    condition: string;
    condition_zh: string;
    likelihood: "high" | "moderate" | "low";
    urgency: "emergency" | "urgent" | "routine";
  }>;
  notes: string[];
} {
  // Map canine/feline to dog/cat for fallback DB
  const speciesKey = species === "canine" ? "dog" : species === "feline" ? "cat" : species;
  const speciesDb = DIFFERENTIAL_DB[speciesKey] || {};
  const normalizedSymptoms = symptoms.map((s) => s.toLowerCase().trim());

  const matchedDiffs: DiffEntry[] = [];
  const matchedKeys = new Set<string>();

  for (const [key, diffs] of Object.entries(speciesDb)) {
    const keySymptoms = key.split(",");
    const matchCount = keySymptoms.filter((k) =>
      normalizedSymptoms.some((s) => s.includes(k) || k.includes(s))
    ).length;

    if (matchCount > 0) {
      for (const diff of diffs) {
        if (matchedKeys.has(diff.condition)) continue;
        const sex = input.sex as string | undefined;
        const age_years = input.age_years as number | undefined;
        if (diff.sex_filter && sex && !diff.sex_filter.includes(sex)) continue;
        if (diff.age_filter && age_years !== undefined) {
          if (diff.age_filter.max !== undefined && age_years > diff.age_filter.max) continue;
          if (diff.age_filter.min !== undefined && age_years < diff.age_filter.min) continue;
        }
        matchedDiffs.push(diff);
        matchedKeys.add(diff.condition);
      }
    }
  }

  const notes: string[] = [];
  if (matchedDiffs.length === 0) {
    notes.push("基礎鑑別資料庫中無匹配結果");
  }

  return {
    differentials: matchedDiffs.map((d) => ({
      condition: d.condition,
      condition_zh: d.condition_zh,
      likelihood: d.likelihood,
      urgency: d.urgency,
    })),
    notes,
  };
}
