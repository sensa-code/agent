// ============================================================================
// 中毒劑量計算器
// ============================================================================

export interface ToxicityInput {
  weight_kg: number;
  substance: string;          // "chocolate", "xylitol", "ibuprofen", "grape", etc.
  amount_ingested: number;    // 攝入量 (g or mg depending on substance)
  substance_type?: string;    // e.g., for chocolate: "dark", "milk", "white", "baking"
  species?: "canine" | "feline";
}

export interface ToxicityResult {
  dose_per_kg: number;
  toxic_dose_threshold: number;
  severity: "none" | "mild" | "moderate" | "severe" | "potentially_fatal";
  clinical_signs: string[];
  treatment_priority: string;
  notes: string[];
}

// Theobromine content per gram of chocolate (mg/g)
const CHOCOLATE_THEOBROMINE: Record<string, number> = {
  white: 0.009,
  milk: 2.4,
  dark: 5.5,
  semisweet: 5.3,
  baking: 16.0,
  cocoa_powder: 28.5,
};

// Toxicity thresholds (mg/kg theobromine)
const THEOBROMINE_THRESHOLDS = {
  mild: 20,      // GI signs
  moderate: 40,  // cardiac signs
  severe: 60,    // seizures, death risk
};

export function calculateToxicity(input: ToxicityInput): ToxicityResult {
  const { weight_kg, substance, amount_ingested, substance_type, species = "canine" } = input;

  if (weight_kg <= 0) throw new Error("體重必須大於 0");
  if (amount_ingested < 0) throw new Error("攝入量不能為負數");

  switch (substance.toLowerCase()) {
    case "chocolate":
      return calculateChocolateToxicity(weight_kg, amount_ingested, substance_type || "dark", species);
    case "xylitol":
      return calculateXylitolToxicity(weight_kg, amount_ingested, species);
    case "ibuprofen":
      return calculateIbuprofenToxicity(weight_kg, amount_ingested, species);
    case "grape":
    case "raisin":
      return calculateGrapeToxicity(weight_kg, amount_ingested, species);
    default:
      return {
        dose_per_kg: amount_ingested / weight_kg,
        toxic_dose_threshold: 0,
        severity: "moderate",
        clinical_signs: ["查無此物質的毒性資料，建議聯繫毒物控制中心"],
        treatment_priority: "建議諮詢 ASPCA Animal Poison Control (888-426-4435)",
        notes: [`未知物質: ${substance}，劑量 ${(amount_ingested / weight_kg).toFixed(2)} per kg`],
      };
  }
}

function calculateChocolateToxicity(
  weightKg: number,
  amountG: number,
  chocolateType: string,
  species: string,
): ToxicityResult {
  const theobrominePerG = CHOCOLATE_THEOBROMINE[chocolateType.toLowerCase()] ?? CHOCOLATE_THEOBROMINE.dark;
  const totalTheobromine = amountG * theobrominePerG;
  const dosePerKg = totalTheobromine / weightKg;

  let severity: ToxicityResult["severity"];
  let clinicalSigns: string[];
  let treatmentPriority: string;

  if (dosePerKg < THEOBROMINE_THRESHOLDS.mild) {
    severity = "none";
    clinicalSigns = ["預期無明顯症狀"];
    treatmentPriority = "監控即可，通常不需治療";
  } else if (dosePerKg < THEOBROMINE_THRESHOLDS.moderate) {
    severity = "mild";
    clinicalSigns = ["嘔吐", "腹瀉", "多尿", "多渴", "不安"];
    treatmentPriority = "建議催吐（攝入 2 小時內）+ 活性碳";
  } else if (dosePerKg < THEOBROMINE_THRESHOLDS.severe) {
    severity = "moderate";
    clinicalSigns = ["心搏過速", "心律不整", "肌肉震顫", "躁動", "高體溫"];
    treatmentPriority = "⚠️ 緊急就醫：催吐 + 活性碳 + 心臟監測 + 輸液治療";
  } else {
    severity = "severe";
    clinicalSigns = ["癲癇", "嚴重心律不整", "橫紋肌溶解", "腎衰竭", "可能死亡"];
    treatmentPriority = "🚨 立即急診：重症監護 + 抗癲癇 + 心臟監測 + 積極輸液";
  }

  if (species === "feline") {
    clinicalSigns.push("⚠️ 貓對巧克力毒性更敏感");
  }

  return {
    dose_per_kg: Math.round(dosePerKg * 100) / 100,
    toxic_dose_threshold: THEOBROMINE_THRESHOLDS.mild,
    severity,
    clinical_signs: clinicalSigns,
    treatment_priority: treatmentPriority,
    notes: [
      `巧克力類型: ${chocolateType}`,
      `Theobromine 含量: ${theobrominePerG} mg/g`,
      `總攝入 Theobromine: ${Math.round(totalTheobromine)} mg`,
      `劑量: ${dosePerKg.toFixed(1)} mg/kg`,
    ],
  };
}

function calculateXylitolToxicity(
  weightKg: number,
  amountMg: number,
  species: string,
): ToxicityResult {
  const dosePerKg = amountMg / weightKg;

  // Xylitol thresholds (mg/kg)
  // >100 mg/kg: hypoglycemia
  // >500 mg/kg: liver failure
  let severity: ToxicityResult["severity"];
  let clinicalSigns: string[];

  if (dosePerKg < 100) {
    severity = "mild";
    clinicalSigns = ["可能出現輕微低血糖症狀", "監控精神和食慾"];
  } else if (dosePerKg < 500) {
    severity = "moderate";
    clinicalSigns = ["低血糖（虛弱、共濟失調、癲癇）", "嘔吐"];
  } else {
    severity = "severe";
    clinicalSigns = ["急性肝衰竭", "嚴重低血糖", "凝血障礙", "可能死亡"];
  }

  return {
    dose_per_kg: Math.round(dosePerKg * 100) / 100,
    toxic_dose_threshold: 100,
    severity,
    clinical_signs: clinicalSigns,
    treatment_priority: dosePerKg >= 100
      ? "🚨 緊急就醫：血糖監測 + 葡萄糖輸液 + 肝臟保護"
      : "建議監控血糖",
    notes: [`Xylitol 對犬具高度毒性，${species === "feline" ? "貓的敏感度較低但仍需注意" : "犬極度敏感"}`],
  };
}

function calculateIbuprofenToxicity(
  weightKg: number,
  amountMg: number,
  species: string,
): ToxicityResult {
  const dosePerKg = amountMg / weightKg;

  let severity: ToxicityResult["severity"];
  let clinicalSigns: string[];

  // Ibuprofen thresholds (mg/kg) for dogs
  if (species === "feline") {
    // Cats: much more sensitive
    severity = dosePerKg > 0 ? "severe" : "none";
    clinicalSigns = ["⚠️ 貓對 Ibuprofen 極度敏感", "腎衰竭", "消化道潰瘍", "可能致命"];
  } else if (dosePerKg < 25) {
    severity = "mild";
    clinicalSigns = ["可能無症狀或輕微胃腸不適"];
  } else if (dosePerKg < 50) {
    severity = "moderate";
    clinicalSigns = ["嘔吐", "腹瀉", "消化道潰瘍", "黑便"];
  } else {
    severity = "severe";
    clinicalSigns = ["急性腎衰竭", "消化道穿孔", "癲癇", "昏迷"];
  }

  return {
    dose_per_kg: Math.round(dosePerKg * 100) / 100,
    toxic_dose_threshold: species === "feline" ? 0 : 25,
    severity,
    clinical_signs: clinicalSigns,
    treatment_priority: severity === "severe"
      ? "🚨 立即急診：催吐 + 消化道保護 + 腎功能監測"
      : "建議監控並就醫諮詢",
    notes: [`Ibuprofen 非犬貓安全 NSAID，建議使用 Meloxicam 或 Carprofen`],
  };
}

function calculateGrapeToxicity(
  weightKg: number,
  amountG: number,
  _species: string,
): ToxicityResult {
  const dosePerKg = amountG / weightKg;

  return {
    dose_per_kg: Math.round(dosePerKg * 100) / 100,
    toxic_dose_threshold: 0, // No safe dose established
    severity: amountG > 0 ? "severe" : "none",
    clinical_signs: ["⚠️ 葡萄/葡萄乾毒性無已知安全劑量", "急性腎衰竭", "嘔吐", "少尿/無尿"],
    treatment_priority: amountG > 0
      ? "🚨 立即就醫：催吐 + 活性碳 + 積極輸液 48hr + 腎功能監測"
      : "無攝入風險",
    notes: [
      "葡萄/葡萄乾對犬的毒性機制尚不明確",
      "個體差異極大，任何劑量都應視為緊急",
      "早期積極治療預後較佳",
    ],
  };
}
