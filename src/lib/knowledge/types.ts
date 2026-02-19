// ============================================================================
// Knowledge Layer — 共用型別定義
// ============================================================================

/**
 * 統一知識項目 — 所有知識來源回傳的標準化格式
 * VETPRO / RAG / PubMed / openFDA 都會被轉換為此格式
 */
export interface KnowledgeItem {
  source: "vetpro" | "rag" | "pubmed" | "openfda";
  /** 標題（英文） */
  title: string;
  /** 標題（中文，VETPRO 有） */
  titleZh?: string;
  /** 摘要/內容片段（截斷後） */
  content: string;
  /** VETPRO disease/drug slug */
  slug?: string;
  /** 發表年份 */
  year?: number;
  /** RAG 向量相似度 (0-1) */
  similarity?: number;
  /** 統一相關性評分 (0-1)，由 result-merger 計算 */
  relevanceScore: number;
  /** 統一引用格式 */
  citation: KnowledgeCitation;
}

export interface KnowledgeCitation {
  title: string;
  source: string;
  year?: number;
  url?: string;
  pmid?: string;
  journal?: string;
  sourceOrg?: string;
  sourceType?: "vetpro" | "rag" | "pubmed" | "openfda";
}

// ─── VETPRO API 回傳型別 ───

export interface VetproDiseaseListItem {
  slug: string;
  nameEn: string;
  nameZh: string | null;
  bodySystem: string;
  description: string | null;
}

export interface VetproDiseaseDetail {
  id: string;
  slug: string;
  nameEn: string;
  nameZh: string | null;
  bodySystem: string;
  description: string | null;
  etiology: unknown;
  pathophysiology: string | null;
  clinicalSigns: unknown;
  diagnosis: unknown;
  treatment: unknown;
  prognosis: unknown;
  stagingSystem: unknown;
  emergencyNotes: string | null;
  diagnosticAlgorithm: unknown;
  clinicalPearls: string[] | null;
  monitoringItems: unknown;
  ddxSource: string | null;
  aliases: string[] | null;
  species: string[];
  references: VetproReference[];
  ontologyMappings: unknown;
}

export interface VetproReference {
  id: string;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  url: string | null;
  sourceType: string;
  sourceOrg: string | null;
  relevance: string;
  section: string;
}

export interface VetproDrugListItem {
  id: string;
  slug: string;
  nameEn: string;
  nameZh: string | null;
  classification: string;
  formulation: string | null;
  supportedSpecies: string[];
}

export interface VetproDrugDetail {
  id: string;
  slug: string;
  nameEn: string;
  nameZh: string | null;
  tradeNames: string[];
  classification: string;
  formulation: string | null;
  pharmacology: unknown;
  pharmacokinetics: unknown;
  structuredAdverseEffects: unknown;
  supportedSpecies: string[];
  metadata: unknown;
  dosages: VetproDosage[];
  interactions: VetproInteraction[];
  relatedDiseases: unknown[];
}

export interface VetproDosage {
  species: string;
  indication: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string | null;
  notes: string | null;
}

export interface VetproInteraction {
  drugA: { id: string; slug: string; nameEn: string };
  drugB: { id: string; slug: string; nameEn: string };
  severity: "high" | "moderate" | "low";
  mechanism: string | null;
  interactionLevel: "drug" | "class";
}

export interface VetproSymptom {
  id: string;
  zhName: string;
  enName: string;
  section: string;
  sectionName: string;
  description: string;
  differentialCount: number;
}

export interface VetproLabFinding {
  id: string;
  zhName: string;
  enName: string;
  category: string;
  diseaseCount: number;
}

export interface VetproSearchResult {
  diseases: VetproDiseaseListItem[];
  drugs: VetproDrugListItem[];
}

export interface VetproDDXResult {
  slug: string;
  nameEn: string;
  nameZh: string | null;
  bodySystem: string;
  description: string | null;
  ddxSource: string | null;
  matchCount: number;
  labMatchCount: number;
  totalSymptoms: number;
  totalLabs: number;
  matchedSymptoms: string[];
  matchedLabs: string[];
  compositeScore: number;
  urgencyScore: number;
  frequencyScore: number;
  species: string[];
}

// ─── PubMed API 型別 ───

export interface PubMedArticle {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: number;
  doi?: string;
}

// ─── Client Options ───

export interface KnowledgeSearchOptions {
  species?: string;
  maxResults?: number;
  includeRAG?: boolean;
  includePubMed?: boolean;
}

export interface DDXOptions {
  species?: string;
  exclude?: string[];
}

export interface DrugSearchOptions {
  species?: string;
  checkInteractions?: string[];
}
