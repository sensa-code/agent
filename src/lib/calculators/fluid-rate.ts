// ============================================================================
// 輸液速率計算器
// ============================================================================

export interface FluidRateInput {
  weight_kg: number;
  dehydration_percent: number; // 0-15
  correction_hours?: number;   // default 24
  maintenance_factor?: number; // default: 50 ml/kg/day for cat, 60 for dog
  species?: "canine" | "feline";
  ongoing_losses_ml_per_hour?: number;
}

export interface FluidRateResult {
  deficit_ml: number;
  maintenance_ml_per_day: number;
  correction_rate_ml_per_hour: number;
  total_rate_ml_per_hour: number;
  total_volume_24h: number;
  notes: string[];
}

export function calculateFluidRate(input: FluidRateInput): FluidRateResult {
  const {
    weight_kg,
    dehydration_percent,
    correction_hours = 24,
    species = "canine",
    ongoing_losses_ml_per_hour = 0,
  } = input;

  if (weight_kg <= 0) throw new Error("體重必須大於 0");
  if (dehydration_percent < 0 || dehydration_percent > 15) {
    throw new Error("脫水百分比必須在 0-15% 之間");
  }
  if (correction_hours <= 0) throw new Error("校正時數必須大於 0");

  // Maintenance rate: cat ~50ml/kg/day, dog ~60ml/kg/day
  const maintenanceFactor = input.maintenance_factor ?? (species === "feline" ? 50 : 60);
  const maintenancePerDay = weight_kg * maintenanceFactor;
  const maintenancePerHour = maintenancePerDay / 24;

  // Deficit = body weight (kg) × dehydration (%) × 10
  const deficitMl = weight_kg * dehydration_percent * 10;

  // Correction rate over specified hours
  const correctionPerHour = deficitMl / correction_hours;

  const totalRatePerHour = maintenancePerHour + correctionPerHour + ongoing_losses_ml_per_hour;
  const totalVolume24h = totalRatePerHour * 24;

  const notes: string[] = [];
  if (dehydration_percent >= 10) {
    notes.push("⚠️ 嚴重脫水（≥10%），建議前 4-6 小時加速校正，之後調降速率");
  }
  if (species === "feline" && totalRatePerHour > weight_kg * 5) {
    notes.push("⚠️ 貓的輸液速率偏高，注意心臟負荷");
  }
  if (dehydration_percent >= 12) {
    notes.push("⚠️ 極度脫水，建議考慮靜脈膠體溶液或高滲鹽水");
  }

  return {
    deficit_ml: Math.round(deficitMl),
    maintenance_ml_per_day: Math.round(maintenancePerDay),
    correction_rate_ml_per_hour: Math.round(correctionPerHour * 10) / 10,
    total_rate_ml_per_hour: Math.round(totalRatePerHour * 10) / 10,
    total_volume_24h: Math.round(totalVolume24h),
    notes,
  };
}
