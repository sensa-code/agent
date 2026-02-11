// ============================================================================
// Tool: differential_diagnosis — 鑑別診斷邏輯
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";

/** Tool Schema for Claude API */
export const differentialDiagnosisSchema: ToolDefinition = {
  name: "differential_diagnosis",
  description:
    "根據臨床症狀、物種、年齡、品種產生鑑別診斷清單。按可能性排序並標註緊急程度。",
  input_schema: {
    type: "object" as const,
    properties: {
      symptoms: {
        type: "array",
        items: { type: "string" },
        description: "臨床症狀列表（英文），例如 ['polyuria', 'polydipsia', 'weight loss']",
      },
      species: {
        type: "string",
        enum: ["canine", "feline", "rabbit", "avian", "reptile", "exotic"],
        description: "物種",
      },
      age_years: {
        type: "number",
        description: "年齡（歲）",
      },
      breed: {
        type: "string",
        description: "品種",
      },
      sex: {
        type: "string",
        enum: ["male_intact", "male_neutered", "female_intact", "female_spayed"],
        description: "性別和絕育狀態",
      },
      additional_info: {
        type: "string",
        description: "額外臨床資訊（病史、檢驗結果等）",
      },
    },
    required: ["symptoms", "species"],
  },
};

export interface DifferentialResult {
  differentials: Array<{
    condition: string;
    condition_zh: string;
    likelihood: "high" | "moderate" | "low";
    urgency: "emergency" | "urgent" | "routine";
    key_features: string[];
    recommended_tests: string[];
  }>;
  species: string;
  symptoms: string[];
  notes: string[];
}

// Knowledge base for common differential diagnoses
const DIFFERENTIAL_DB: Record<string, Record<string, DiffEntry[]>> = {
  canine: {
    "polyuria,polydipsia": [
      { condition: "Pyometra", condition_zh: "子宮蓄膿", likelihood: "high", urgency: "emergency", sex_filter: ["female_intact"], key_features: ["Intact female", "vaginal discharge", "lethargy"], tests: ["CBC", "Abdominal ultrasound", "Progesterone"] },
      { condition: "Diabetes mellitus", condition_zh: "糖尿病", likelihood: "high", urgency: "urgent", key_features: ["Hyperglycemia", "glucosuria", "weight loss"], tests: ["Blood glucose", "Fructosamine", "Urinalysis"] },
      { condition: "Hyperadrenocorticism (Cushing's)", condition_zh: "庫欣氏症", likelihood: "high", urgency: "routine", key_features: ["Pot-bellied appearance", "skin changes", "panting"], tests: ["LDDS test", "ACTH stimulation", "Abdominal ultrasound"] },
      { condition: "Chronic kidney disease", condition_zh: "慢性腎病", likelihood: "high", urgency: "urgent", key_features: ["Azotemia", "isosthenuria", "weight loss"], tests: ["Creatinine", "SDMA", "Urinalysis with UPC"] },
      { condition: "Hypercalcemia", condition_zh: "高血鈣症", likelihood: "moderate", urgency: "urgent", key_features: ["Lymphadenopathy", "neoplasia"], tests: ["Ionized calcium", "PTH", "PTHrP"] },
      { condition: "Diabetes insipidus", condition_zh: "尿崩症", likelihood: "low", urgency: "routine", key_features: ["Very dilute urine", "no glucosuria"], tests: ["Water deprivation test", "Desmopressin trial"] },
      { condition: "Hepatic disease", condition_zh: "肝病", likelihood: "moderate", urgency: "urgent", key_features: ["Elevated liver enzymes", "jaundice"], tests: ["Liver panel", "Bile acids", "Ultrasound"] },
    ],
    "vomiting": [
      { condition: "Foreign body obstruction", condition_zh: "異物阻塞", likelihood: "high", urgency: "emergency", key_features: ["Acute onset", "nonproductive retching", "abdominal pain"], tests: ["Abdominal radiographs", "Barium study", "Ultrasound"] },
      { condition: "Pancreatitis", condition_zh: "胰臟炎", likelihood: "high", urgency: "urgent", key_features: ["Abdominal pain", "anorexia", "diarrhea"], tests: ["cPLI/SNAP cPL", "Ultrasound", "CBC"] },
      { condition: "Gastritis", condition_zh: "胃炎", likelihood: "high", urgency: "routine", key_features: ["Dietary indiscretion", "self-limiting"], tests: ["Symptomatic treatment trial"] },
      { condition: "Addison's disease", condition_zh: "愛迪生氏症", likelihood: "moderate", urgency: "emergency", key_features: ["Waxing-waning history", "bradycardia", "Na:K ratio <27"], tests: ["Electrolytes", "ACTH stimulation", "Cortisol"] },
    ],
    "lameness_forelimb": [
      { condition: "Osteosarcoma", condition_zh: "骨肉瘤", likelihood: "high", urgency: "urgent", breed_risk: ["Great Dane", "Rottweiler", "Irish Wolfhound", "Greyhound"], key_features: ["Large breed", "metaphyseal swelling", "progressive lameness"], tests: ["Radiographs", "ALP", "Thoracic radiographs"] },
      { condition: "Hypertrophic osteodystrophy (HOD)", condition_zh: "肥大性骨營養不良", likelihood: "moderate", urgency: "urgent", age_filter: { max: 1 }, key_features: ["Young large breed", "fever", "metaphyseal swelling"], tests: ["Radiographs", "CBC"] },
      { condition: "Panosteitis", condition_zh: "全骨炎", likelihood: "moderate", urgency: "routine", age_filter: { min: 0.5, max: 2 }, key_features: ["Shifting lameness", "young large breed", "self-limiting"], tests: ["Long bone radiographs"] },
      { condition: "Elbow dysplasia", condition_zh: "肘關節發育不良", likelihood: "high", urgency: "routine", key_features: ["Bilateral forelimb", "young to middle-aged"], tests: ["Elbow radiographs", "CT scan"] },
    ],
  },
  feline: {
    "vomiting": [
      { condition: "Inflammatory bowel disease (IBD)", condition_zh: "炎症性腸病", likelihood: "high", urgency: "routine", key_features: ["Chronic intermittent", "weight loss", "normal appetite or decreased"], tests: ["Cobalamin/Folate", "Abdominal ultrasound", "Endoscopy + biopsy"] },
      { condition: "Intestinal lymphoma", condition_zh: "腸道淋巴瘤", likelihood: "moderate", urgency: "urgent", key_features: ["Weight loss", "thickened bowel", "older cat"], tests: ["Abdominal ultrasound", "FNA", "Biopsy (full thickness)"] },
      { condition: "Pancreatitis", condition_zh: "胰臟炎", likelihood: "high", urgency: "urgent", key_features: ["Anorexia", "lethargy", "often concurrent hepatic lipidosis"], tests: ["fPLI/SNAP fPL", "Ultrasound"] },
      { condition: "Foreign body", condition_zh: "異物阻塞", likelihood: "moderate", urgency: "emergency", key_features: ["Linear foreign body common in cats", "strings/ribbons"], tests: ["Abdominal radiographs", "Ultrasound"] },
      { condition: "Hyperthyroidism", condition_zh: "甲狀腺功能亢進", likelihood: "moderate", urgency: "routine", key_features: ["Weight loss despite good appetite", "older cat", "tachycardia"], tests: ["Total T4", "Free T4"] },
    ],
    "jaundice": [
      { condition: "Hepatic lipidosis", condition_zh: "肝臟脂肪變性", likelihood: "high", urgency: "emergency", key_features: ["Anorexia > 3 days", "obese cat", "icterus"], tests: ["Liver enzymes", "Bilirubin", "Ultrasound", "FNA cytology"] },
      { condition: "Cholangitis/Cholangiohepatitis", condition_zh: "膽管炎", likelihood: "high", urgency: "urgent", key_features: ["Fever", "abdominal pain", "elevated liver enzymes"], tests: ["CBC", "Liver panel", "Bile culture", "Ultrasound + biopsy"] },
      { condition: "FIP (Feline Infectious Peritonitis)", condition_zh: "貓傳染性腹膜炎", likelihood: "moderate", urgency: "urgent", key_features: ["Young cat", "effusion", "high protein effusion", "hyperglobulinemia"], tests: ["Rivalta test", "A:G ratio", "Effusion cytology + RT-PCR"] },
      { condition: "Triaditis", condition_zh: "三臟器炎症", likelihood: "moderate", urgency: "urgent", key_features: ["Concurrent IBD + pancreatitis + cholangitis"], tests: ["fPLI", "Liver enzymes", "Ultrasound", "Biopsy"] },
      { condition: "Hemolytic anemia", condition_zh: "溶血性貧血", likelihood: "moderate", urgency: "emergency", key_features: ["Pale gums", "tachycardia", "splenomegaly", "spherocytes"], tests: ["CBC with reticulocyte count", "Coombs test", "Blood smear"] },
    ],
    "polyuria,polydipsia": [
      { condition: "Chronic kidney disease", condition_zh: "慢性腎病", likelihood: "high", urgency: "urgent", key_features: ["Older cat", "weight loss", "azotemia"], tests: ["Creatinine", "SDMA", "UPC", "Urinalysis"] },
      { condition: "Diabetes mellitus", condition_zh: "糖尿病", likelihood: "high", urgency: "urgent", key_features: ["Overweight cat", "plantigrade stance", "hyperglycemia"], tests: ["Blood glucose", "Fructosamine", "Urinalysis"] },
      { condition: "Hyperthyroidism", condition_zh: "甲狀腺功能亢進", likelihood: "high", urgency: "routine", key_features: ["Older cat", "weight loss", "tachycardia", "palpable thyroid nodule"], tests: ["Total T4", "Free T4"] },
    ],
  },
};

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

/** 生成鑑別診斷清單 */
export function generateDifferentialDiagnosis(input: {
  symptoms: string[];
  species: string;
  age_years?: number;
  breed?: string;
  sex?: string;
  additional_info?: string;
}): DifferentialResult {
  const { symptoms, species, age_years, breed, sex } = input;

  const speciesDb = DIFFERENTIAL_DB[species] || {};
  const normalizedSymptoms = symptoms.map(s => s.toLowerCase().trim());

  // Find matching differential lists
  const matchedDiffs: DiffEntry[] = [];
  const matchedKeys = new Set<string>();

  for (const [key, diffs] of Object.entries(speciesDb)) {
    const keySymptoms = key.split(",");
    const matchCount = keySymptoms.filter(k =>
      normalizedSymptoms.some(s => s.includes(k) || k.includes(s))
    ).length;

    if (matchCount > 0) {
      for (const diff of diffs) {
        const condKey = diff.condition;
        if (!matchedKeys.has(condKey)) {
          // Apply filters
          if (diff.sex_filter && sex && !diff.sex_filter.includes(sex)) continue;
          if (diff.age_filter) {
            if (age_years !== undefined) {
              if (diff.age_filter.max !== undefined && age_years > diff.age_filter.max) continue;
              if (diff.age_filter.min !== undefined && age_years < diff.age_filter.min) continue;
            }
          }

          // Adjust likelihood based on breed risk
          let likelihood = diff.likelihood;
          if (diff.breed_risk && breed) {
            if (diff.breed_risk.some(b => breed.toLowerCase().includes(b.toLowerCase()))) {
              likelihood = "high";
            }
          }

          matchedDiffs.push({ ...diff, likelihood });
          matchedKeys.add(condKey);
        }
      }
    }
  }

  // Sort by urgency then likelihood
  const urgencyOrder = { emergency: 0, urgent: 1, routine: 2 };
  const likelihoodOrder = { high: 0, moderate: 1, low: 2 };

  matchedDiffs.sort((a, b) => {
    const urgDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (urgDiff !== 0) return urgDiff;
    return likelihoodOrder[a.likelihood] - likelihoodOrder[b.likelihood];
  });

  const notes: string[] = [];

  // Species-specific notes
  if (species === "canine" && normalizedSymptoms.some(s => s.includes("hyperthyroid"))) {
    notes.push("⚠️ 甲狀腺功能亢進在犬極為罕見，通常為甲狀腺腫瘤所致");
  }
  if (species === "feline" && normalizedSymptoms.some(s => s.includes("cushing") || s.includes("hyperadreno"))) {
    notes.push("⚠️ 庫欣氏症在貓極為罕見，通常與糖尿病併發");
  }

  if (age_years !== undefined && age_years < 1) {
    notes.push("幼年動物：優先考慮先天性疾病、感染性疾病和營養性問題");
  }
  if (age_years !== undefined && age_years > 10) {
    notes.push("老年動物：優先考慮腫瘤、代謝性疾病和器官退化");
  }

  if (matchedDiffs.length === 0) {
    notes.push("知識庫中無直接匹配的鑑別診斷，建議使用 search_vet_literature 搜尋文獻");
  }

  return {
    differentials: matchedDiffs.map(d => ({
      condition: d.condition,
      condition_zh: d.condition_zh,
      likelihood: d.likelihood,
      urgency: d.urgency,
      key_features: d.key_features,
      recommended_tests: d.tests,
    })),
    species,
    symptoms,
    notes,
  };
}
