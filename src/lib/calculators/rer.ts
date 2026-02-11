// ============================================================================
// 靜息能量需求 (RER) 計算器
// ============================================================================

export interface RERInput {
  weight_kg: number;
  species?: "canine" | "feline";
  illness_factor?: number; // 1.0-2.0, default varies
  life_stage?: "adult" | "puppy" | "kitten" | "senior" | "pregnant" | "lactating";
}

export interface RERResult {
  rer_kcal: number;          // 基礎靜息能量
  mer_kcal: number;          // 維持能量需求 (RER × factor)
  illness_factor: number;
  formula_used: string;
  notes: string[];
}

export function calculateRER(input: RERInput): RERResult {
  const { weight_kg, species = "canine", life_stage = "adult" } = input;

  if (weight_kg <= 0) throw new Error("體重必須大於 0");

  // RER calculation:
  // For animals 2-45 kg: RER = 70 × (BW in kg)^0.75
  // For animals < 2 kg or > 45 kg: RER = 30 × BW + 70
  let rer: number;
  let formulaUsed: string;

  if (weight_kg >= 2 && weight_kg <= 45) {
    rer = 70 * Math.pow(weight_kg, 0.75);
    formulaUsed = `70 × ${weight_kg}^0.75 = ${Math.round(rer)} kcal/day`;
  } else {
    rer = 30 * weight_kg + 70;
    formulaUsed = `30 × ${weight_kg} + 70 = ${Math.round(rer)} kcal/day`;
  }

  // Illness/life stage factor
  let factor = input.illness_factor ?? getDefaultFactor(species, life_stage);

  const mer = rer * factor;

  const notes: string[] = [];
  if (species === "feline" && weight_kg > 8) {
    notes.push("貓體重偏高，建議考慮減重計畫");
  }
  if (life_stage === "puppy" || life_stage === "kitten") {
    notes.push("幼年動物能量需求較高，需少量多餐");
  }
  if (factor > 1.5) {
    notes.push("高能量需求，建議監測體重和體態評分 (BCS)");
  }

  return {
    rer_kcal: Math.round(rer),
    mer_kcal: Math.round(mer),
    illness_factor: factor,
    formula_used: formulaUsed,
    notes,
  };
}

function getDefaultFactor(species: string, lifeStage: string): number {
  const factors: Record<string, Record<string, number>> = {
    canine: {
      adult: 1.6,
      senior: 1.4,
      puppy: 3.0,
      pregnant: 1.8,
      lactating: 4.0,
    },
    feline: {
      adult: 1.4,
      senior: 1.1,
      kitten: 2.5,
      pregnant: 1.6,
      lactating: 2.5,
    },
  };
  return factors[species]?.[lifeStage] ?? 1.4;
}
