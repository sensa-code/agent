// ============================================================================
// RAG Client — 包裝現有 Supabase 向量搜尋為統一介面
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import type { KnowledgeItem } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ─── Embedding Generation ───

async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[rag-client] OPENAI_API_KEY not set, skipping RAG search");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[rag-client] Embedding API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (err) {
    console.warn("[rag-client] Embedding generation failed:", err);
    return null;
  }
}

// ─── Public API ───

/**
 * Search RAG vector database and return standardized KnowledgeItems
 */
export async function search(
  query: string,
  options?: { maxResults?: number }
): Promise<KnowledgeItem[]> {
  if (!supabaseUrl || !supabaseKey) {
    console.warn("[rag-client] Supabase not configured, skipping RAG search");
    return [];
  }

  const maxResults = options?.maxResults || 5;

  // Generate embedding
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("rag_match_documents", {
      query_embedding: embedding,
      match_count: maxResults,
      match_threshold: 0.5,
      filter_category: null,
      filter_species: null,
    });

    if (error) {
      console.error("[rag-client] RAG vector search error:", error);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Normalize to KnowledgeItem[]
    return (data as Array<Record<string, unknown>>).map((doc) => {
      const metadata = (doc.metadata as Record<string, unknown>) || {};
      const title = (doc.title as string) || "Untitled";
      const source = (metadata.source as string) || "Knowledge Base";
      const year = metadata.year as number | undefined;
      const similarity = (doc.similarity as number) || 0;

      return {
        source: "rag" as const,
        title,
        content: ((doc.content as string) || "").substring(0, 400),
        year,
        similarity,
        relevanceScore: similarity, // Will be re-weighted by merger
        citation: {
          title,
          source,
          year,
          sourceType: "rag" as const,
        },
      };
    });
  } catch (err) {
    console.error("[rag-client] RAG search failed:", err);
    return [];
  }
}

/**
 * Check if RAG is configured
 */
export function isConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseKey && process.env.OPENAI_API_KEY);
}
