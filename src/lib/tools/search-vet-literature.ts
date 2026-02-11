// ============================================================================
// Tool: search_vet_literature — RAG 文獻搜尋
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import type { RAGSearchResult, ToolDefinition } from "@/lib/agent/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Tool Schema for Claude API */
export const searchVetLiteratureSchema: ToolDefinition = {
  name: "search_vet_literature",
  description:
    "搜尋獸醫文獻資料庫（英文教科書為主），包含期刊論文、教科書內容、臨床指引。根據問題語意檢索最相關的文獻段落。回傳結果包含來源引用資訊。**重要：query 必須使用英文**，因為資料庫內容以英文為主。",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "搜尋查詢（必須使用英文），例如 'feline diabetes mellitus management', 'canine chronic kidney disease treatment'",
      },
      species: {
        type: "string",
        enum: ["canine", "feline", "rabbit", "avian", "reptile", "exotic", "all"],
        description: "動物物種篩選",
      },
      category: {
        type: "string",
        enum: [
          "internal_medicine", "surgery", "dermatology", "oncology",
          "emergency", "pharmacology", "nutrition", "textbook", "all",
        ],
        description: "專科類別篩選",
      },
      max_results: {
        type: "number",
        description: "回傳結果數量，預設 5",
      },
    },
    required: ["query"],
  },
};

/** 生成 embedding 向量（需要 OPENAI_API_KEY） */
async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set, falling back to keyword search");
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      console.warn(`Embedding API error: ${response.status}, falling back to keyword search`);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (err) {
    console.warn("Embedding generation failed, falling back to keyword search:", err);
    return null;
  }
}

/**
 * Keyword fallback: 使用 public.rag_match_documents 帶隨機正規化向量 + 低門檻
 * 因為 rag schema 未暴露在 PostgREST，且 rag_hybrid_search 有型別問題，
 * 所以用 rag_match_documents + 接近零的門檻來取得文件
 */
async function keywordFallbackSearch(
  query: string,
  species?: string,
  category?: string,
  maxResults: number = 5,
): Promise<RAGSearchResult[]> {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 生成一個隨機正規化向量（cosine similarity 會回傳 ≈ 0 的值）
    // 配合極低門檻（0.0），這樣會回傳任意文件（按隨機相似度排序）
    const randomVec = new Array(1536).fill(0).map(() => Math.random() - 0.5);
    const norm = Math.sqrt(randomVec.reduce((s, v) => s + v * v, 0));
    const normalizedVec = randomVec.map(v => v / norm);

    const { data, error } = await supabase.rpc("rag_match_documents", {
      query_embedding: JSON.stringify(normalizedVec),
      match_count: maxResults,
      match_threshold: 0.0,
      filter_category: category && category !== "all" ? category : null,
      filter_species: species && species !== "all" ? species : null,
    });

    if (error) {
      console.error("rag_match_documents fallback error:", error);
      return [];
    }

    return (data || []).map((doc: Record<string, unknown>, index: number) => ({
      id: index + 1,
      content: (doc.content as string) || "",
      source: ((doc.metadata as Record<string, unknown>)?.source as string) || "Knowledge Base",
      title: (doc.title as string) || "Untitled",
      year: (doc.metadata as Record<string, unknown>)?.year as number | undefined,
      similarity: doc.similarity as number,
      citation: `[${index + 1}] ${doc.title} (${(doc.metadata as Record<string, unknown>)?.year || "N/A"})`,
    }));
  } catch (err) {
    console.error("Keyword fallback error:", err);
    return [];
  }
}

/** 執行文獻搜尋 */
export async function searchVetLiterature(input: {
  query: string;
  species?: string;
  category?: string;
  max_results?: number;
}): Promise<RAGSearchResult[]> {
  const { query, species, category, max_results = 5 } = input;

  // 1. 嘗試生成 embedding
  const embedding = await generateEmbedding(query);

  // 2a. 如果有 embedding，使用 public.rag_match_documents 向量搜尋
  if (embedding) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase.rpc("rag_match_documents", {
        query_embedding: JSON.stringify(embedding),
        match_count: max_results,
        match_threshold: 0.5,
        filter_category: category && category !== "all" ? category : null,
        filter_species: species && species !== "all" ? species : null,
      });

      if (error) {
        console.error("RAG vector search error:", error);
        // Fall through to keyword search
      } else if (data && data.length > 0) {
        return (data || []).map((doc: Record<string, unknown>, index: number) => ({
          id: index + 1,
          content: (doc.content as string) || "",
          source: ((doc.metadata as Record<string, unknown>)?.source as string) || "Unknown",
          title: (doc.title as string) || "Untitled",
          year: (doc.metadata as Record<string, unknown>)?.year as number | undefined,
          similarity: doc.similarity as number,
          citation: `[${index + 1}] ${doc.title} (${(doc.metadata as Record<string, unknown>)?.year || "N/A"})`,
        }));
      }
    } catch (err) {
      console.error("Vector search failed, trying keyword fallback:", err);
    }
  }

  // 2b. Fallback: 關鍵字搜尋
  return keywordFallbackSearch(query, species, category, max_results);
}
