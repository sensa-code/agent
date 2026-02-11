// ============================================================================
// CKD IRIS 分期計算器
// ============================================================================

export interface IRISInput {
  creatinine_mg_dl: number;
  sdma_ug_dl?: number;
  species: "canine" | "feline";
  upc?: number;           // Urine Protein:Creatinine ratio
  blood_pressure_mmhg?: number;
}

export interface IRISResult {
  stage: 1 | 2 | 3 | 4;
  stage_description: string;
  substage_proteinuria?: string;
  substage_hypertension?: string;
  creatinine_range: string;
  notes: string[];
  management_recommendations: string[];
}

export function calculateIRISStaging(input: IRISInput): IRISResult {
  const { creatinine_mg_dl, sdma_ug_dl, species, upc, blood_pressure_mmhg } = input;

  if (creatinine_mg_dl <= 0) throw new Error("Creatinine 必須大於 0");

  // IRIS staging based on species
  const stage = getStage(creatinine_mg_dl, sdma_ug_dl, species);
  const stageDesc = getStageDescription(stage);
  const creatRange = getCreatinineRange(stage, species);

  const notes: string[] = [];
  const recommendations: string[] = [];

  // SDMA consideration
  if (sdma_ug_dl !== undefined) {
    if (species === "canine" && sdma_ug_dl > 18) {
      notes.push(`SDMA ${sdma_ug_dl} µg/dL 偏高（犬正常 <18），可能比 Creatinine 更早反映腎功能下降`);
    } else if (species === "feline" && sdma_ug_dl > 18) {
      notes.push(`SDMA ${sdma_ug_dl} µg/dL 偏高（貓正常 <18），建議結合 Creatinine 評估`);
    }
  }

  // Proteinuria substaging
  let substageProteinuria: string | undefined;
  if (upc !== undefined) {
    if (species === "canine") {
      if (upc < 0.2) substageProteinuria = "Non-proteinuric (NP)";
      else if (upc <= 0.5) substageProteinuria = "Borderline proteinuric (BP)";
      else substageProteinuria = "Proteinuric (P)";
    } else {
      if (upc < 0.2) substageProteinuria = "Non-proteinuric (NP)";
      else if (upc <= 0.4) substageProteinuria = "Borderline proteinuric (BP)";
      else substageProteinuria = "Proteinuric (P)";
    }
    if (upc !== undefined && upc > 0.5) {
      recommendations.push("蛋白尿管理：考慮 ACE inhibitor (Benazepril) 或 ARB (Telmisartan)");
    }
  }

  // Blood pressure substaging
  let substageHypertension: string | undefined;
  if (blood_pressure_mmhg !== undefined) {
    if (blood_pressure_mmhg < 140) substageHypertension = "Normotensive (AP0)";
    else if (blood_pressure_mmhg < 160) substageHypertension = "Prehypertensive (AP1)";
    else if (blood_pressure_mmhg < 180) substageHypertension = "Hypertensive (AP2)";
    else substageHypertension = "Severely hypertensive (AP3)";

    if (blood_pressure_mmhg >= 160) {
      recommendations.push("高血壓管理：考慮 Amlodipine（貓首選）或 ACE inhibitor");
      notes.push("⚠️ 高血壓可能導致眼、腦、腎、心臟的靶器官損傷");
    }
  }

  // Stage-specific recommendations
  switch (stage) {
    case 1:
      recommendations.push("定期監測 Creatinine, SDMA, UPC, 血壓（每 3-6 個月）");
      recommendations.push("處理任何潛在腎臟疾病（如感染、結石）");
      break;
    case 2:
      recommendations.push("開始腎臟處方飲食（低磷、適度限制蛋白質）");
      recommendations.push("每 2-3 個月監測腎功能");
      recommendations.push("注意水分攝取，鼓勵飲水");
      break;
    case 3:
      recommendations.push("腎臟處方飲食 + 磷結合劑");
      recommendations.push("補充水分（考慮皮下輸液）");
      recommendations.push("監測電解質、酸鹼平衡");
      recommendations.push("評估是否需要紅血球生成素（EPO）治療貧血");
      recommendations.push("每 1-2 個月監測");
      break;
    case 4:
      recommendations.push("🚨 終末期腎病：積極支持療法");
      recommendations.push("皮下輸液、磷結合劑、制酸劑、止吐藥");
      recommendations.push("評估生活品質和預後");
      recommendations.push("每 2-4 週密切監測");
      break;
  }

  return {
    stage,
    stage_description: stageDesc,
    substage_proteinuria: substageProteinuria,
    substage_hypertension: substageHypertension,
    creatinine_range: creatRange,
    notes,
    management_recommendations: recommendations,
  };
}

function getStage(creatinine: number, sdma: number | undefined, species: string): 1 | 2 | 3 | 4 {
  if (species === "canine") {
    // Canine IRIS staging
    if (creatinine < 1.4) return sdma !== undefined && sdma >= 18 ? 1 : 1;
    if (creatinine <= 2.8) return 2;
    if (creatinine <= 5.0) return 3;
    return 4;
  } else {
    // Feline IRIS staging
    if (creatinine < 1.6) return sdma !== undefined && sdma >= 18 ? 1 : 1;
    if (creatinine <= 2.8) return 2;
    if (creatinine <= 5.0) return 3;
    return 4;
  }
}

function getStageDescription(stage: number): string {
  switch (stage) {
    case 1: return "Stage 1 — 非氮血症期（Nonazotemic）";
    case 2: return "Stage 2 — 輕度氮血症（Mild renal azotemia）";
    case 3: return "Stage 3 — 中度氮血症（Moderate renal azotemia）";
    case 4: return "Stage 4 — 重度氮血症（Severe renal azotemia）";
    default: return "Unknown";
  }
}

function getCreatinineRange(stage: number, species: string): string {
  if (species === "canine") {
    switch (stage) {
      case 1: return "<1.4 mg/dL";
      case 2: return "1.4–2.8 mg/dL";
      case 3: return "2.9–5.0 mg/dL";
      case 4: return ">5.0 mg/dL";
      default: return "";
    }
  } else {
    switch (stage) {
      case 1: return "<1.6 mg/dL";
      case 2: return "1.6–2.8 mg/dL";
      case 3: return "2.9–5.0 mg/dL";
      case 4: return ">5.0 mg/dL";
      default: return "";
    }
  }
}
