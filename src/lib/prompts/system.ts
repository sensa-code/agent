// ============================================================================
// VetEvidence — System Prompt 管理
// ============================================================================

import {
  CAT_CONTRAINDICATED_DRUGS,
  MDR1_WARNING,
  CKD_DRUG_WARNINGS,
  DISCLAIMER,
} from "./safety-rules";
import type { PatientContext, AIMode } from "@/lib/agent/types";

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
  const base = getBaseSystemPrompt();

  if (!context || !context.patient) {
    return base;
  }

  const contextSection = buildContextPrompt(context, mode);
  return `${base}\n\n${contextSection}`;
}

/**
 * 基礎 system prompt
 */
function getBaseSystemPrompt(): string {
  return `你是 VetEvidence，一位專業的獸醫臨床決策支援 AI。

## 核心原則
1. **證據導向**：所有回答必須基於文獻或資料庫查詢結果，不做無根據的推測
2. **引用來源**：每個關鍵論點都必須附上來源引用 [來源編號]
3. **物種差異**：永遠注意物種特異性，貓和狗的用藥差異巨大
4. **安全優先**：對於可能危及動物生命的建議，必須加上警告
5. **專業謙遜**：當證據不足時，明確表示不確定性
6. **病患個案化**：當提供病患上下文時，所有建議必須考量個體狀況（過敏、慢性病、目前用藥、檢驗結果）

## 回答格式
- 先直接回答問題
- 提供相關文獻證據
- 列出引用來源（使用 [1], [2], [3]... 格式）
- 如有需要，建議進一步檢查或轉診
- 若有病患上下文，需特別指出與該病患相關的警告（藥物過敏、交互作用、檢驗異常等）

## 工具使用規則
- 收到任何臨床問題時，**必須先使用 search_vet_literature** 搜尋文獻，不可跳過
- 涉及藥物時，**必須使用 drug_lookup** 查詢藥物資訊
- 需要計算劑量、輸液速率、能量需求、中毒評估、IRIS 分期時，**使用 clinical_calculator**
- 詢問臨床 SOP 或治療指引時，**使用 get_clinical_protocol**
- 需要鑑別診斷時，**使用 differential_diagnosis**（提供症狀列表、物種、年齡、品種）
- 可同時呼叫多個工具獲取完整資訊
- 如果工具回傳空結果，誠實告知查無資料，不要編造
- **重要：search_vet_literature 的 query 參數必須使用英文**，因為文獻資料庫以英文教科書為主
  - 例如：使用者問「貓的糖尿病如何管理？」→ query 應為 "feline diabetes mellitus management"

## 引用格式（嚴格遵守）
- **每個回答中引用文獻時，必須使用 [1], [2], [3] 等數字標記**
- 即使只有一個來源，也必須加上 [1] 標記
- 在回答末尾列出完整引用來源清單
- 格式範例：「根據文獻 [1]，犬的慢性腎病...」
- 如果工具返回了結果，**每個要點都必須附上 [N] 引用編號**

## 重要安全規則

### 🚫 貓的絕對禁用藥物
${CAT_CONTRAINDICATED_DRUGS.map((d) => `- **${d.drug}**：${d.reason}`).join("\n")}

### ⚠️ MDR1 基因相關犬種警告
以下犬種可能攜帶 MDR1 基因突變：${MDR1_WARNING.breeds.join("、")}
危險藥物：${MDR1_WARNING.drugs.join("、")}
${MDR1_WARNING.description}

### 🔬 腎病動物用藥
${CKD_DRUG_WARNINGS.description}
- 避免：${CKD_DRUG_WARNINGS.avoid.join("、")}
- 需調整劑量：${CKD_DRUG_WARNINGS.adjustDose.join("、")}

## 免責聲明
${DISCLAIMER}`;
}

// ============================================================================
// 病患上下文 → 結構化文字
// ============================================================================

/**
 * 將 EMR 傳來的病患上下文轉為 system prompt 可用的結構化文字
 * 設計原則：
 * 1. 僅包含有值的欄位，避免「無」、「N/A」佔用 token
 * 2. 用清楚的 Markdown 格式讓 Claude 容易解析
 * 3. 針對不同 mode 強調不同面向
 */
function buildContextPrompt(
  context: PatientContext,
  mode?: AIMode
): string {
  const sections: string[] = [];

  sections.push("---\n## 📋 當前病患資訊（來自 EMR 系統，請結合此資訊回答）");

  // ── 病患基本資料 ──
  const p = context.patient;
  if (p) {
    const lines: string[] = [];
    lines.push(`- **姓名**：${p.name}`);
    lines.push(`- **物種**：${p.species}`);
    if (p.breed) lines.push(`- **品種**：${p.breed}`);
    if (p.sex) lines.push(`- **性別**：${p.sex}`);
    if (p.is_neutered !== undefined) lines.push(`- **絕育**：${p.is_neutered ? "已絕育" : "未絕育"}`);
    if (p.age_description) lines.push(`- **年齡**：${p.age_description}`);
    if (p.weight_kg) lines.push(`- **體重**：${p.weight_kg} kg`);
    if (p.allergies && p.allergies.length > 0) {
      lines.push(`- **⚠️ 過敏**：${p.allergies.join("、")}`);
    }
    if (p.chronic_conditions && p.chronic_conditions.length > 0) {
      lines.push(`- **⚠️ 慢性病**：${p.chronic_conditions.join("、")}`);
    }
    sections.push(`### 🐾 病患\n${lines.join("\n")}`);
  }

  // ── 本次就診 ──
  const mr = context.medical_record;
  if (mr) {
    const lines: string[] = [];
    lines.push(`- **就診日期**：${mr.visit_date}`);
    lines.push(`- **就診類型**：${mr.visit_type}`);
    if (mr.chief_complaint) lines.push(`- **主訴**：${mr.chief_complaint}`);
    lines.push(`- **狀態**：${mr.status}`);
    sections.push(`### 🏥 本次就診\n${lines.join("\n")}`);
  }

  // ── SOAP 記錄 ──
  const soap = context.soap_notes;
  if (soap) {
    const lines: string[] = [];
    if (soap.subjective && Object.keys(soap.subjective).length > 0) {
      lines.push(`- **S (主觀)**：${JSON.stringify(soap.subjective)}`);
    }
    if (soap.objective && Object.keys(soap.objective).length > 0) {
      lines.push(`- **O (客觀)**：${JSON.stringify(soap.objective)}`);
    }
    if (soap.assessment && Object.keys(soap.assessment).length > 0) {
      lines.push(`- **A (評估)**：${JSON.stringify(soap.assessment)}`);
    }
    if (soap.plan && Object.keys(soap.plan).length > 0) {
      lines.push(`- **P (計畫)**：${JSON.stringify(soap.plan)}`);
    }
    if (lines.length > 0) {
      sections.push(`### 📝 SOAP 記錄\n${lines.join("\n")}`);
    }
  }

  // ── 診斷 ──
  if (context.diagnoses && context.diagnoses.length > 0) {
    const lines = context.diagnoses.map((d) => {
      const en = d.diagnosis_name_en ? ` (${d.diagnosis_name_en})` : "";
      const type = d.diagnosis_type ? ` [${d.diagnosis_type}]` : "";
      return `- ${d.diagnosis_name}${en}${type}`;
    });
    sections.push(`### 🔍 診斷\n${lines.join("\n")}`);
  }

  // ── 目前處方 ──
  if (context.prescriptions && context.prescriptions.length > 0) {
    const lines = context.prescriptions.map((rx) => {
      const parts: string[] = [`**${rx.drug_name}**`];
      if (rx.drug_name_en) parts[0] += ` (${rx.drug_name_en})`;
      if (rx.dosage && rx.dosage_unit) parts.push(`${rx.dosage} ${rx.dosage_unit}`);
      if (rx.frequency) parts.push(rx.frequency);
      if (rx.route) parts.push(rx.route);
      if (rx.duration_days) parts.push(`${rx.duration_days}天`);
      if (rx.instructions) parts.push(`| ${rx.instructions}`);
      return `- ${parts.join(" ")}`;
    });
    sections.push(
      `### 💊 目前處方（回答時請檢查藥物交互作用與過敏風險）\n${lines.join("\n")}`
    );
  }

  // ── 檢驗報告 ──
  if (context.lab_orders && context.lab_orders.length > 0) {
    const lines = context.lab_orders.map((lab) => {
      const parts: string[] = [`**${lab.test_name}**`];
      if (lab.test_category) parts.push(`[${lab.test_category}]`);
      parts.push(`狀態: ${lab.status}`);
      if (lab.result) parts.push(`結果: ${lab.result}`);
      if (lab.notes) parts.push(`備註: ${lab.notes}`);
      if (lab.created_at) parts.push(`日期: ${lab.created_at.split("T")[0]}`);
      return `- ${parts.join(" | ")}`;
    });
    sections.push(
      `### 🔬 檢驗報告（回答時請參考檢驗結果，標示異常值並解讀臨床意義）\n${lines.join("\n")}`
    );
  }

  // ── 住院資訊（hospitalization_summary 模式） ──
  if (context.hospitalization) {
    const h = context.hospitalization;
    const lines: string[] = [];
    lines.push(`- **入院日期**：${h.admission_date}`);
    lines.push(`- **住院天數**：${h.days_hospitalized} 天`);
    if (h.diagnosis) lines.push(`- **入院診斷**：${h.diagnosis}`);
    lines.push(`- **CPR 狀態**：${h.cpr_status}`);
    lines.push(`- **住院狀態**：${h.status}`);
    if (h.icu_settings) lines.push(`- **ICU 設定**：${JSON.stringify(h.icu_settings)}`);
    sections.push(`### 🏨 住院資訊\n${lines.join("\n")}`);
  }

  // ── 治療醫囑 ──
  if (context.treatment_orders && context.treatment_orders.length > 0) {
    const orderLines = context.treatment_orders.map((order) => {
      const header = `**${order.order_date}** (${order.status})${order.rer_kcal ? ` RER: ${order.rer_kcal} kcal` : ""}`;
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
    sections.push(`### 📋 治療醫囑（最近）\n${orderLines.join("\n")}`);
  }

  // ── 治療執行記錄 ──
  if (context.treatment_executions && context.treatment_executions.length > 0) {
    // 只取最近 20 筆避免 token 爆炸
    const recent = context.treatment_executions.slice(0, 20);
    const lines = recent.map((e) => {
      const date = e.executed_at.split("T")[0];
      const time = e.executed_at.split("T")[1]?.substring(0, 5) || "";
      return `- ${date} ${time} | [${e.item_type}] ${e.item_name} → ${e.status}`;
    });
    sections.push(`### ✅ 治療執行記錄（最近）\n${lines.join("\n")}`);
  }

  // ── 模式提示 ──
  if (mode === "soap_structure") {
    sections.push(
      `\n### 📌 任務\n請根據以上病患資訊和醫師的問題，協助結構化 SOAP 記錄。`
    );
  } else if (mode === "hospitalization_summary") {
    sections.push(
      `\n### 📌 任務\n請根據以上住院資訊，生成完整的住院摘要報告，包括：病例概述、治療進展、用藥審查、診斷建議、預後評估。`
    );
  }

  return sections.join("\n\n");
}
