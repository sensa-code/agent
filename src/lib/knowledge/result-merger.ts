// ============================================================================
// Result Merger — 知識結果融合 + 去重 + 排序 + 截斷
// ============================================================================

import type { KnowledgeItem, KnowledgeSearchOptions } from "./types";
import * as vetproClient from "./vetpro-client";
import * as ragClient from "./rag-client";
import * as pubmedClient from "./pubmed-client";

// ─── Source Weights ───
// VETPRO（專家審核結構化百科）> RAG（文獻向量搜尋）> PubMed（外部補充）
const SOURCE_WEIGHTS: Record<string, number> = {
  vetpro: 1.0,
  rag: 0.7,
  pubmed: 0.5,
};

// ─── Deduplication ───

/**
 * 簡單字串相似度 (Jaccard similarity on word-level bigrams)
 */
function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const wordsA = new Set(normalize(a).split(/\s+/));
  const wordsB = new Set(normalize(b).split(/\s+/));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * 去除重複項目：
 * - 同一 slug 的 VETPRO 結果只保留一個
 * - 標題相似度 > 0.7 的項目只保留權重較高的
 */
function deduplicate(items: KnowledgeItem[]): KnowledgeItem[] {
  const result: KnowledgeItem[] = [];
  const seenSlugs = new Set<string>();

  for (const item of items) {
    // Check slug dedup (VETPRO)
    if (item.slug) {
      if (seenSlugs.has(item.slug)) continue;
      seenSlugs.add(item.slug);
    }

    // Check title similarity dedup
    let isDuplicate = false;
    for (const existing of result) {
      if (titleSimilarity(item.title, existing.title) > 0.7) {
        // Keep the one with higher relevanceScore
        if (item.relevanceScore > existing.relevanceScore) {
          const idx = result.indexOf(existing);
          result[idx] = item;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(item);
    }
  }

  return result;
}

// ─── Normalization ───

/**
 * Apply source weight to all items from a source
 */
function applyWeights(
  items: KnowledgeItem[],
  sourceWeight: number
): KnowledgeItem[] {
  return items.map((item, index) => ({
    ...item,
    // Position-based score decay: first result gets full weight, decreases by 10% per position
    relevanceScore: sourceWeight * Math.max(0.3, 1 - index * 0.1),
  }));
}

// ─── Main Merger Functions ───

/**
 * 統一知識搜尋 — 並行查詢 VETPRO + RAG + PubMed，融合結果
 */
export async function mergeKnowledgeResults(
  query: string,
  options: KnowledgeSearchOptions = {}
): Promise<KnowledgeItem[]> {
  const maxResults = options.maxResults || 10;

  // Prepare VETPRO search (FTS5)
  const vetproPromise = vetproClient.isConfigured()
    ? vetproClient.search(query).then((result) => {
        const items: KnowledgeItem[] = [];

        // Convert diseases
        for (const d of result.diseases?.slice(0, 5) || []) {
          items.push({
            source: "vetpro",
            title: d.nameEn,
            titleZh: d.nameZh || undefined,
            content: d.description || "",
            slug: d.slug,
            relevanceScore: 0,
            citation: {
              title: d.nameEn,
              source: "VetPro Encyclopedia",
              sourceType: "vetpro",
            },
          });
        }

        // Convert drugs
        for (const d of result.drugs?.slice(0, 3) || []) {
          items.push({
            source: "vetpro",
            title: d.nameEn,
            titleZh: d.nameZh || undefined,
            content: `${d.classification}. ${d.formulation || ""}`,
            slug: d.slug,
            relevanceScore: 0,
            citation: {
              title: d.nameEn,
              source: "VetPro Drug Database",
              sourceType: "vetpro",
            },
          });
        }

        return items;
      }).catch((err) => {
        console.warn("[merger] VETPRO search failed:", err);
        return [] as KnowledgeItem[];
      })
    : Promise.resolve([] as KnowledgeItem[]);

  // Prepare RAG search (vector)
  const ragPromise = options.includeRAG !== false && ragClient.isConfigured()
    ? ragClient.search(query, { maxResults: 5 }).catch((err) => {
        console.warn("[merger] RAG search failed:", err);
        return [] as KnowledgeItem[];
      })
    : Promise.resolve([] as KnowledgeItem[]);

  // Prepare PubMed search (external)
  const pubmedPromise = options.includePubMed
    ? pubmedClient.search(query, { maxResults: 5 }).catch((err) => {
        console.warn("[merger] PubMed search failed:", err);
        return [] as KnowledgeItem[];
      })
    : Promise.resolve([] as KnowledgeItem[]);

  // Parallel execution — don't wait for the slowest
  const [vetproResult, ragResult, pubmedResult] = await Promise.allSettled([
    vetproPromise,
    ragPromise,
    pubmedPromise,
  ]);

  // Extract results (allSettled returns PromiseSettledResult)
  const vetproItems = vetproResult.status === "fulfilled" ? vetproResult.value : [];
  const ragItems = ragResult.status === "fulfilled" ? ragResult.value : [];
  const pubmedItems = pubmedResult.status === "fulfilled" ? pubmedResult.value : [];

  // Apply source weights
  const weighted = [
    ...applyWeights(vetproItems, SOURCE_WEIGHTS.vetpro),
    ...applyWeights(ragItems, SOURCE_WEIGHTS.rag),
    ...applyWeights(pubmedItems, SOURCE_WEIGHTS.pubmed),
  ];

  // Deduplicate
  const deduped = deduplicate(weighted);

  // Sort by relevanceScore descending
  deduped.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Truncate to maxResults
  return deduped.slice(0, maxResults);
}

/**
 * 統一藥物搜尋 — VETPRO 為主，RAG 為 fallback
 */
export async function mergeDrugResults(
  drugName: string,
  options: { species?: string; maxResults?: number } = {}
): Promise<KnowledgeItem[]> {
  const maxResults = options.maxResults || 5;

  // VETPRO drug search (primary)
  const vetproPromise = vetproClient.isConfigured()
    ? vetproClient.searchDrugs(drugName, { species: options.species }).then((result) =>
        (result.drugs || []).slice(0, maxResults).map((d) => ({
          source: "vetpro" as const,
          title: d.nameEn,
          titleZh: d.nameZh || undefined,
          content: `${d.classification}. ${d.formulation || ""}. Species: ${d.supportedSpecies?.join(", ") || "N/A"}`,
          slug: d.slug,
          relevanceScore: 0,
          citation: {
            title: d.nameEn,
            source: "VetPro Drug Database",
            sourceType: "vetpro" as const,
          },
        }))
      ).catch(() => [] as KnowledgeItem[])
    : Promise.resolve([] as KnowledgeItem[]);

  // RAG fallback (for drug literature)
  const ragPromise = ragClient.isConfigured()
    ? ragClient.search(`${drugName} veterinary pharmacology`, { maxResults: 3 })
        .catch(() => [] as KnowledgeItem[])
    : Promise.resolve([] as KnowledgeItem[]);

  const [vetproItems, ragItems] = await Promise.all([vetproPromise, ragPromise]);

  const weighted = [
    ...applyWeights(vetproItems, SOURCE_WEIGHTS.vetpro),
    ...applyWeights(ragItems, SOURCE_WEIGHTS.rag),
  ];

  const deduped = deduplicate(weighted);
  deduped.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return deduped.slice(0, maxResults);
}
