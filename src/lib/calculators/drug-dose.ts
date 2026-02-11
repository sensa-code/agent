// ============================================================================
// 藥物劑量計算器
// ============================================================================

export interface DrugDoseInput {
  weight_kg: number;
  dose_mg_per_kg: number;
  concentration_mg_per_ml?: number;
  frequency?: string; // "BID", "TID", "SID", "q8h", "q12h" etc.
}

export interface DrugDoseResult {
  total_dose_mg: number;
  volume_ml: number | null;
  daily_dose_mg: number;
  frequency: string;
  notes: string[];
}

const FREQUENCY_MAP: Record<string, number> = {
  SID: 1, QD: 1, "q24h": 1,
  BID: 2, "q12h": 2,
  TID: 3, "q8h": 3,
  QID: 4, "q6h": 4,
};

export function calculateDrugDose(input: DrugDoseInput): DrugDoseResult {
  const { weight_kg, dose_mg_per_kg, concentration_mg_per_ml, frequency = "BID" } = input;

  if (weight_kg <= 0) throw new Error("體重必須大於 0");
  if (dose_mg_per_kg <= 0) throw new Error("劑量必須大於 0");
  if (concentration_mg_per_ml !== undefined && concentration_mg_per_ml <= 0) {
    throw new Error("藥物濃度必須大於 0");
  }

  const freqUpper = frequency.toUpperCase();
  const timesPerDay = FREQUENCY_MAP[freqUpper] || FREQUENCY_MAP[frequency] || 2;

  const totalDose = weight_kg * dose_mg_per_kg;
  const volumeMl = concentration_mg_per_ml
    ? totalDose / concentration_mg_per_ml
    : null;
  const dailyDose = totalDose * timesPerDay;

  const notes: string[] = [];
  if (weight_kg < 1) notes.push("體重極低，請特別注意劑量精確度");
  if (weight_kg > 80) notes.push("大型犬體重，建議確認劑量上限");

  return {
    total_dose_mg: Math.round(totalDose * 100) / 100,
    volume_ml: volumeMl !== null ? Math.round(volumeMl * 100) / 100 : null,
    daily_dose_mg: Math.round(dailyDose * 100) / 100,
    frequency: freqUpper,
    notes,
  };
}
