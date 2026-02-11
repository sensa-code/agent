// ============================================================================
// Tool: clinical_calculator — 臨床計算引擎
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import { calculateDrugDose } from "@/lib/calculators/drug-dose";
import { calculateFluidRate } from "@/lib/calculators/fluid-rate";
import { calculateRER } from "@/lib/calculators/rer";
import { calculateToxicity } from "@/lib/calculators/toxicity";
import { calculateIRISStaging } from "@/lib/calculators/iris-staging";

/** Tool Schema for Claude API */
export const clinicalCalculatorSchema: ToolDefinition = {
  name: "clinical_calculator",
  description:
    "獸醫臨床計算器：藥物劑量、輸液速率、能量需求 (RER)、中毒劑量評估、CKD IRIS 分期。根據臨床參數進行精確計算。",
  input_schema: {
    type: "object" as const,
    properties: {
      calculator_type: {
        type: "string",
        enum: ["drug_dose", "fluid_rate", "rer", "toxicity", "iris_staging"],
        description: "計算器類型",
      },
      parameters: {
        type: "object",
        description: "計算參數（依計算器類型不同）",
        properties: {
          // Common
          weight_kg: { type: "number", description: "體重 (kg)" },
          species: { type: "string", enum: ["canine", "feline"], description: "物種" },
          // Drug dose
          dose_mg_per_kg: { type: "number", description: "劑量 (mg/kg)" },
          concentration_mg_per_ml: { type: "number", description: "藥物濃度 (mg/ml)" },
          frequency: { type: "string", description: "給藥頻率 (SID, BID, TID, QID)" },
          // Fluid rate
          dehydration_percent: { type: "number", description: "脫水百分比 (0-15)" },
          correction_hours: { type: "number", description: "校正時數" },
          // RER
          life_stage: { type: "string", enum: ["adult", "puppy", "kitten", "senior", "pregnant", "lactating"] },
          illness_factor: { type: "number", description: "疾病/活動係數" },
          // Toxicity
          substance: { type: "string", description: "中毒物質名稱" },
          amount_ingested: { type: "number", description: "攝入量" },
          substance_type: { type: "string", description: "物質細分類型" },
          // IRIS
          creatinine_mg_dl: { type: "number", description: "Creatinine (mg/dL)" },
          sdma_ug_dl: { type: "number", description: "SDMA (µg/dL)" },
          upc: { type: "number", description: "UPC ratio" },
          blood_pressure_mmhg: { type: "number", description: "血壓 (mmHg)" },
        },
      },
    },
    required: ["calculator_type", "parameters"],
  },
};

/** 執行臨床計算 */
export function clinicalCalculate(input: {
  calculator_type: string;
  parameters: Record<string, unknown>;
}): unknown {
  const { calculator_type, parameters } = input;
  const p = parameters;

  try {
    switch (calculator_type) {
      case "drug_dose":
        return {
          calculator: "drug_dose",
          result: calculateDrugDose({
            weight_kg: p.weight_kg as number,
            dose_mg_per_kg: p.dose_mg_per_kg as number,
            concentration_mg_per_ml: p.concentration_mg_per_ml as number | undefined,
            frequency: (p.frequency as string) || "BID",
          }),
        };

      case "fluid_rate":
        return {
          calculator: "fluid_rate",
          result: calculateFluidRate({
            weight_kg: p.weight_kg as number,
            dehydration_percent: p.dehydration_percent as number,
            correction_hours: p.correction_hours as number | undefined,
            species: (p.species as "canine" | "feline") || "canine",
          }),
        };

      case "rer":
        return {
          calculator: "rer",
          result: calculateRER({
            weight_kg: p.weight_kg as number,
            species: (p.species as "canine" | "feline") || "canine",
            life_stage: p.life_stage as "adult" | "puppy" | "kitten" | "senior" | "pregnant" | "lactating",
            illness_factor: p.illness_factor as number | undefined,
          }),
        };

      case "toxicity":
        return {
          calculator: "toxicity",
          result: calculateToxicity({
            weight_kg: p.weight_kg as number,
            substance: p.substance as string,
            amount_ingested: p.amount_ingested as number,
            substance_type: p.substance_type as string | undefined,
            species: (p.species as "canine" | "feline") || "canine",
          }),
        };

      case "iris_staging":
        return {
          calculator: "iris_staging",
          result: calculateIRISStaging({
            creatinine_mg_dl: p.creatinine_mg_dl as number,
            sdma_ug_dl: p.sdma_ug_dl as number | undefined,
            species: (p.species as "canine" | "feline") || "canine",
            upc: p.upc as number | undefined,
            blood_pressure_mmhg: p.blood_pressure_mmhg as number | undefined,
          }),
        };

      default:
        return { error: `未知計算器類型: ${calculator_type}` };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      calculator: calculator_type,
    };
  }
}
