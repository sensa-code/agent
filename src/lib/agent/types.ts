// ============================================================================
// VetEvidence Agent — 共用型別定義
// ============================================================================

import type Anthropic from "@anthropic-ai/sdk";

// ─── Agent Loop Types ───

export interface AgentRequest {
  messages: ChatMessage[];
  conversationId?: string;
  userId?: string;
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
