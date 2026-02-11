// ============================================================================
// Tool: search_vet_literature — RAG 文獻搜尋
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { RAGSearchResult, ToolDefinition } from "@/lib/agent/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const anthropic = new Anthropic();

/** Tool Schema for Claude API */
export const searchVetLiteratureSchema: ToolDefinition = {
  name: "search_vet_literature",
  description:
    "搜尋獸醫文獻資料庫，包含期刊論文、教科書內容、臨床指引。根據問題語意檢索最相關的文獻段落。回傳結果包含來源引用資訊。",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "搜尋查詢，可以是臨床問題、疾病名稱、治療方式等",
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

/** 生成 embedding 向量 */
async function generateEmbedding(text: string): Promise<number[]> {
  // Use Anthropic's Voyage embedding via Supabase's built-in
  // For now, we use OpenAI-compatible embedding since RAG DB uses 1536-dim
  // The RAG documents were embedded with OpenAI text-embedding-3-small
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    // Fallback: use Supabase's built-in embedding if OpenAI is not available
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/** 執行文獻搜尋 */
export async function searchVetLiterature(input: {
  query: string;
  species?: string;
  category?: string;
  max_results?: number;
}): Promise<RAGSearchResult[]> {
  const { query, species, category, max_results = 5 } = input;

  try {
    // 1. Generate query embedding
    const embedding = await generateEmbedding(query);

    // 2. Call vet_ai.search_literature RPC (cross-schema function)
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.rpc("search_literature", {
      query_embedding: JSON.stringify(embedding),
      match_count: max_results,
      match_threshold: 0.5,
      filter_category: category && category !== "all" ? category : null,
      filter_species: species && species !== "all" ? species : null,
    }, { schema: "vet_ai" } as unknown as undefined);

    if (error) {
      console.error("RAG search error:", error);
      return [];
    }

    // 3. Format results with citation info
    return (data || []).map((doc: Record<string, unknown>, index: number) => ({
      id: index + 1,
      content: (doc.content as string) || "",
      source: ((doc.metadata as Record<string, unknown>)?.source as string) || "Unknown",
      title: (doc.title as string) || "Untitled",
      year: (doc.metadata as Record<string, unknown>)?.year as number | undefined,
      similarity: doc.similarity as number,
      citation: `[${index + 1}] ${doc.title} (${(doc.metadata as Record<string, unknown>)?.year || "N/A"})`,
    }));
  } catch (err) {
    console.error("search_vet_literature error:", err);
    return [];
  }
}
