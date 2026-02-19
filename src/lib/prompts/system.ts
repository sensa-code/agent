// ============================================================================
// VetEvidence — System Prompt 管理（已精簡，降低 ~40% token 消耗）
// ============================================================================

import {
  CAT_CONTRAINDICATED_DRUGS,
  MDR1_WARNING,
  CKD_DRUG_WARNINGS,
  DISCLAIMER,
} from "./safety-rules";
import type { PatientContext, AIMode } from "@/lib/agent/types";

// ============================================================================
// Public API
// ============================================================================

/**
 * 取得基礎 system prompt（不含病患上下文）
 */
export function getSystemPrompt(): string {
  return getBaseSystemPrompt();
}

/**
 * 取得含病患上下文的 system prompt
 * 將 EMR 傳來的 context 轉為結構化文字，附加在 system prompt 後
 */
export function getSystemPromptWithContext(
  context?: PatientContext,
  mode?: AIMode
): string {
  // 從 context 中提取物種和慢性病資訊，用於條件式安全規則
  const species = context?.patient?.species;
  const chronicConditions = context?.patient?.chronic_conditions;

  const base = getBaseSystemPrompt({ species, chronicConditions, mode });

  if (!context || !context.patient) {
    return base;
  }

  const contextSection = buildContextPrompt(context, mode);
  return `${base}\n\n${contextSection}`;
}

// ============================================================================
// Base System Prompt（依 mode 動態組裝）
// ============================================================================

interface PromptOptions {
  species?: string;
  chronicConditions?: string[];
  mode?: AIMode;
}

/**
 * 基礎 system prompt — 依 mode 和病患屬性動態組裝
 * - chat/consultation: 完整 prompt（含工具規則、引用規則、安全規則）
 * - soap_structure / hospitalization_summary: 精簡版（無工具規則）
 * - 安全規則依物種和慢性病條件式包含
 */
function getBaseSystemPrompt(options?: PromptOptions): string {
  const mode = options?.mode;
  const isFastMode = mode === "soap_structure" || mode === "hospitalization_summary";

  const sections: string[] = [];

  // ── 角色定義 + 核心原則 ──
  sections.push(`你是 VetEvidence，獸醫臨床決策支援 AI。

## 原則
1. 證據導向：回答基於文獻/資料庫，不推測
2. 引用：關鍵論點附 [N] 來源，末尾列完整清單
3. 物種差異：注意物種特異性用藥
4. 安全優先：危及生命須警告
5. 不確定時明確表示
6. 有病患上下文時考量個體狀況（過敏、慢性病、用藥、檢驗）`);

  // ── 回答格式（所有模式都需要） ──
  sections.push(`## 回答格式
- 先直接回答，附文獻證據，每要點附 [N] 引用
- 末尾列完整來源清單（[N] 書名 (年份)）
- 有上下文時指出相關警告（過敏、交互作用、異常值）
- 必要時建議進一步檢查`);

  // ── 工具規則（僅 chat/consultation 模式，fast mode 不含工具） ──
  if (!isFastMode) {
    sections.push(`## 工具（必須使用）
**重要：你必須在回答前使用工具查詢。禁止僅憑自身知識回答臨床問題。**
- 疾病/臨床問題→vet_knowledge_search（自動融合百科+文獻+最新研究，query中英文皆可）
- 藥物問題→drug_info（含劑量/交互作用/不良反應，可同時查多藥交互）
- 鑑別診斷→differential_diagnosis（2563疾病庫，症狀+Lab複合評分）
- 劑量/輸液/RER/IRIS→clinical_calculator
- **首輪即同時呼叫所有需要的工具（parallel tool calls），避免多輪來回**
- 引用百科/文獻來源，空結果誠實告知不編造`);
  }

  // ── 安全規則（條件式） ──
  const safetyLines = buildSafetyRules(options);
  if (safetyLines) {
    sections.push(safetyLines);
  }

  // ── 免責聲明 ──
  sections.push(`## 免責\n${DISCLAIMER}`);

  return sections.join("\n\n");
}

// ============================================================================
// 安全規則 — 依物種 & 慢性病條件式包含
// ============================================================================

/**
 * 根據物種和慢性病狀況，選擇性包含安全規則
 * - 無 context（泛用查詢）：包含所有安全規則
 * - 犬：包含 MDR1 + CKD（如有腎病）
 * - 貓：包含貓禁用藥 + CKD（如有腎病）
 * - 其他：僅 CKD（如有腎病）
 */
function buildSafetyRules(options?: PromptOptions): string | null {
  const species = options?.species;
  const conditions = options?.chronicConditions || [];

  // 判斷是否有腎病相關慢性病
  const hasCKD =
    !species || // 無物種 = 泛用，包含所有
    conditions.some(
      (c) =>
        c.includes("CKD") ||
        c.includes("腎") ||
        c.toLowerCase().includes("kidney") ||
        c.toLowerCase().includes("renal")
    );

  // 判斷物種
  const isCat = !species || species === "貓" || species.toLowerCase().includes("feline") || species.toLowerCase().includes("cat");
  const isDog = !species || species === "犬" || species.toLowerCase().includes("canine") || species.toLowerCase().includes("dog");

  const rules: string[] = [];

  // 貓禁用藥
  if (isCat) {
    const catDrugs = CAT_CONTRAINDICATED_DRUGS.map(
      (d) => `- **${d.drug}**：${d.reason}`
    ).join("\n");
    rules.push(`### 貓禁用藥\n${catDrugs}`);
  }

  // MDR1
  if (isDog) {
    rules.push(
      `### MDR1 犬種警告\n犬種：${MDR1_WARNING.breeds.join("、")}\n藥物：${MDR1_WARNING.drugs.join("、")}\n${MDR1_WARNING.description}`
    );
  }

  // CKD
  if (hasCKD) {
    rules.push(
      `### 腎病用藥\n${CKD_DRUG_WARNINGS.description}\n- 避免：${CKD_DRUG_WARNINGS.avoid.join("、")}\n- 調整劑量：${CKD_DRUG_WARNINGS.adjustDose.join("、")}`
    );
  }

  if (rules.length === 0) return null;
  return `## 安全規則\n${rules.join("\n\n")}`;
}

// ============================================================================
// 病患上下文 → 精簡結構化文字
// ============================================================================

/**
 * 將 EMR 傳來的病患上下文轉為 system prompt 可用的結構化文字
 * 設計原則：
 * 1. 僅包含有值的欄位，避免佔用 token
 * 2. 用緊湊的 pipe-separated 格式（比 Markdown 列表省 ~30% token）
 * 3. 針對不同 mode 強調不同面向
 */
function buildContextPrompt(
  context: PatientContext,
  mode?: AIMode
): string {
  const sections: string[] = [];

  sections.push("---\n## 病患資訊");

  // ── 病患基本資料（pipe-separated 緊湊格式） ──
  const p = context.patient;
  if (p) {
    const basic: string[] = [p.name, p.species];
    if (p.breed) basic.push(p.breed);
    if (p.sex) basic.push(p.sex);
    if (p.is_neutered !== undefined) basic.push(p.is_neutered ? "已絕育" : "未絕育");
    if (p.age_description) basic.push(p.age_description);
    if (p.weight_kg) basic.push(`${p.weight_kg}kg`);

    const lines: string[] = [basic.join(" | ")];
    if (p.allergies && p.allergies.length > 0) {
      lines.push(`⚠️過敏: ${p.allergies.join("、")}`);
    }
    if (p.chronic_conditions && p.chronic_conditions.length > 0) {
      lines.push(`⚠️慢性病: ${p.chronic_conditions.join("、")}`);
    }
    sections.push(`### 病患\n${lines.join("\n")}`);
  }

  // ── 本次就診 ──
  const mr = context.medical_record;
  if (mr) {
    const parts: string[] = [mr.visit_date, mr.visit_type];
    if (mr.chief_complaint) parts.push(`主訴: ${mr.chief_complaint}`);
    parts.push(mr.status);
    sections.push(`### 就診\n${parts.join(" | ")}`);
  }

  // ── SOAP 記錄（key=value 格式取代 JSON.stringify） ──
  const soap = context.soap_notes;
  if (soap) {
    const lines: string[] = [];
    if (soap.subjective && Object.keys(soap.subjective).length > 0) {
      lines.push(`S: ${flattenObj(soap.subjective)}`);
    }
    if (soap.objective && Object.keys(soap.objective).length > 0) {
      lines.push(`O: ${flattenObj(soap.objective)}`);
    }
    if (soap.assessment && Object.keys(soap.assessment).length > 0) {
      lines.push(`A: ${flattenObj(soap.assessment)}`);
    }
    if (soap.plan && Object.keys(soap.plan).length > 0) {
      lines.push(`P: ${flattenObj(soap.plan)}`);
    }
    if (lines.length > 0) {
      sections.push(`### SOAP\n${lines.join("\n")}`);
    }
  }

  // ── 診斷 ──
  if (context.diagnoses && context.diagnoses.length > 0) {
    const lines = context.diagnoses.map((d) => {
      const en = d.diagnosis_name_en ? ` (${d.diagnosis_name_en})` : "";
      const type = d.diagnosis_type ? ` [${d.diagnosis_type}]` : "";
      return `- ${d.diagnosis_name}${en}${type}`;
    });
    sections.push(`### 診斷\n${lines.join("\n")}`);
  }

  // ── 處方（緊湊格式） ──
  if (context.prescriptions && context.prescriptions.length > 0) {
    const lines = context.prescriptions.map((rx) => {
      const parts: string[] = [rx.drug_name];
      if (rx.drug_name_en) parts[0] += `(${rx.drug_name_en})`;
      if (rx.dosage && rx.dosage_unit) parts.push(`${rx.dosage}${rx.dosage_unit}`);
      if (rx.frequency) parts.push(rx.frequency);
      if (rx.route) parts.push(rx.route);
      if (rx.duration_days) parts.push(`${rx.duration_days}d`);
      if (rx.instructions) parts.push(`(${rx.instructions})`);
      return `- ${parts.join(" ")}`;
    });
    sections.push(`### 處方（檢查交互作用與過敏）\n${lines.join("\n")}`);
  }

  // ── 檢驗報告（pipe 格式） ──
  if (context.lab_orders && context.lab_orders.length > 0) {
    const lines = context.lab_orders.map((lab) => {
      const parts: string[] = [lab.test_name];
      if (lab.test_category) parts.push(`[${lab.test_category}]`);
      parts.push(lab.status);
      if (lab.result) parts.push(lab.result);
      if (lab.notes) parts.push(lab.notes);
      if (lab.created_at) parts.push(lab.created_at.split("T")[0]);
      return `- ${parts.join(" | ")}`;
    });
    sections.push(`### 檢驗（標示異常值並解讀）\n${lines.join("\n")}`);
  }

  // ── 住院資訊 ──
  if (context.hospitalization) {
    const h = context.hospitalization;
    const parts: string[] = [
      `入院: ${h.admission_date}`,
      `${h.days_hospitalized}天`,
    ];
    if (h.diagnosis) parts.push(`診斷: ${h.diagnosis}`);
    parts.push(`CPR: ${h.cpr_status}`, h.status);
    if (h.icu_settings) parts.push(`ICU: ${flattenObj(h.icu_settings as Record<string, unknown>)}`);
    sections.push(`### 住院\n${parts.join(" | ")}`);
  }

  // ── 治療醫囑 ──
  if (context.treatment_orders && context.treatment_orders.length > 0) {
    const orderLines = context.treatment_orders.map((order) => {
      const header = `${order.order_date} (${order.status})${order.rer_kcal ? ` RER:${order.rer_kcal}kcal` : ""}`;
      const items = order.items
        .filter((i) => i.is_active)
        .map((i) => {
          const parts = [i.name];
          if (i.dosage) parts.push(i.dosage);
          if (i.frequency) parts.push(i.frequency);
          if (i.route) parts.push(i.route);
          return `  - [${i.item_type}] ${parts.join(" ")}`;
        });
      return `- ${header}\n${items.join("\n")}`;
    });
    sections.push(`### 治療醫囑\n${orderLines.join("\n")}`);
  }

  // ── 治療執行記錄（最多 15 筆） ──
  if (context.treatment_executions && context.treatment_executions.length > 0) {
    const recent = context.treatment_executions.slice(0, 15);
    const lines = recent.map((e) => {
      const dt = e.executed_at.split("T");
      const time = dt[1]?.substring(0, 5) || "";
      return `- ${dt[0]} ${time} [${e.item_type}] ${e.item_name} → ${e.status}`;
    });
    sections.push(`### 執行記錄\n${lines.join("\n")}`);
  }

  // ── 模式任務提示（壓縮版 JSON 模板） ──
  if (mode === "soap_structure") {
    sections.push(
      `\n### 任務：SOAP 結構化
根據以上資訊整理 SOAP。回答末尾必須附 \`\`\`json 區塊：
\`\`\`json
{"structured_soap":{"subjective":{"chief_complaint":"","history":"","symptoms":[]},"objective":{"physical_exam":"","vital_signs":{},"lab_results":""},"assessment":{"primary_diagnosis":"","differential_diagnosis":[],"clinical_reasoning":""},"plan":{"diagnostics":[],"treatment":[],"monitoring":[],"client_education":""}}}
\`\`\`
EMR 需要此 JSON 區塊。`
    );
  } else if (mode === "hospitalization_summary") {
    sections.push(
      `\n### 任務：住院摘要
根據以上住院資訊生成摘要。回答末尾必須附 \`\`\`json 區塊：
\`\`\`json
{"summary":{"case_overview":"","treatment_progress":"","vital_sign_trends":"","medication_review":{"current_medications":[],"warnings":[],"suggestions":[]},"diagnostic_suggestions":[],"prognosis_notes":""}}
\`\`\`
EMR 需要此 JSON。直接根據上方資訊生成，不需額外使用工具。`
    );
  }

  return sections.join("\n\n");
}

// ============================================================================
// Utility
// ============================================================================

/**
 * 將物件扁平化為 key=value 格式，比 JSON.stringify 節省 token
 */
function flattenObj(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}=[${v.join(",")}]`;
      if (typeof v === "object") return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    })
    .join(", ");
}
