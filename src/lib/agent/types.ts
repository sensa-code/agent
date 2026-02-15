// ============================================================================
// VetEvidence Agent — 共用型別定義
// ============================================================================

import type Anthropic from "@anthropic-ai/sdk";

// ─── Agent Loop Types ───

/** EMR 傳來的病患上下文（由 EMR context-builder 組裝） */
export interface PatientContext {
  patient?: {
    name: string;
    species: string;
    breed?: string;
    weight_kg?: number;
    sex?: string;
    age_description?: string;
    allergies?: string[];
    chronic_conditions?: string[];
    is_neutered?: boolean;
  };
  medical_record?: {
    visit_date: string;
    visit_type: string;
    chief_complaint?: string;
    status: string;
  };
  soap_notes?: {
    subjective: Record<string, unknown>;
    objective: Record<string, unknown>;
    assessment: Record<string, unknown>;
    plan: Record<string, unknown>;
  };
  diagnoses?: Array<{
    diagnosis_name: string;
    diagnosis_name_en?: string;
    diagnosis_type?: string;
  }>;
  prescriptions?: Array<{
    drug_name: string;
    drug_name_en?: string;
    dosage?: number;
    dosage_unit?: string;
    frequency?: string;
    route?: string;
    duration_days?: number;
    instructions?: string;
  }>;
  lab_orders?: Array<{
    test_name: string;
    test_category?: string;
    result?: string;
    status: string;
    notes?: string;
    created_at?: string;
  }>;
  /** 住院相關（hospitalization_summary 模式用） */
  hospitalization?: {
    admission_date: string;
    days_hospitalized: number;
    diagnosis?: string;
    cpr_status: string;
    icu_settings?: Record<string, unknown>;
    status: string;
  };
  treatment_orders?: Array<{
    order_date: string;
    status: string;
    rer_kcal?: number;
    notes?: string;
    items: Array<{
      item_type: string;
      name: string;
      dosage?: string;
      frequency?: string;
      route?: string;
      is_active: boolean;
    }>;
  }>;
  treatment_executions?: Array<{
    item_name: string;
    item_type: string;
    executed_at: string;
    status: string;
  }>;
  /** 預留：未來可擴充影像、更多報告等 */
  [key: string]: unknown;
}

export type AIMode =
  | "chat"
  | "consultation"
  | "soap_structure"
  | "hospitalization_summary";

export interface AgentRequest {
  messages: ChatMessage[];
  conversationId?: string;
  userId?: string;
  /** EMR 傳入的病患上下文 */
  context?: PatientContext;
  /** 查詢模式 */
  mode?: AIMode;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCallRecord[];
  citations: Citation[];
  tokenUsage: TokenUsage;
  latencyMs: number;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

export interface Citation {
  id: number;
  title: string;
  source: string;
  year?: number;
  excerpt?: string;
  similarity?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// ─── Tool Types ───

export type ToolName =
  | "search_vet_literature"
  | "drug_lookup"
  | "clinical_calculator"
  | "get_clinical_protocol"
  | "differential_diagnosis";

export type ToolDefinition = Anthropic.Messages.Tool;

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

// ─── RAG Types ───

export interface RAGDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  species: string[];
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface RAGSearchParams {
  query: string;
  species?: string;
  category?: string;
  maxResults?: number;
}

export interface RAGSearchResult {
  id: number;
  content: string;
  source: string;
  title: string;
  year?: number;
  similarity: number;
  citation: string;
}

// ─── Drug Types ───

export interface DrugInfo {
  id: string;
  nameEn: string;
  nameZh: string;
  classification: string;
  description: string;
  mechanism: string;
  indications: string[];
  contraindications: string[];
  sideEffects: string[];
  interactions: string[];
  dosageDog: Record<string, unknown> | null;
  dosageCat: Record<string, unknown> | null;
  warnings: string[];
}

export interface DrugLookupParams {
  drugName: string;
  species?: string;
  infoType?: "full" | "dosage" | "contraindications" | "interactions" | "side_effects";
}

// ─── Streaming Types ───

export interface StreamEvent {
  type: "text_delta" | "tool_call" | "citation" | "done" | "error";
  data: unknown;
}
