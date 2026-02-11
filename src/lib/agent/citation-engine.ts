// ============================================================================
// VetEvidence — 進階引用引擎（去重 + 交叉引用 + 證據等級）
// ============================================================================

import type { Citation, ToolCallRecord } from "./types";

/** Evidence-Based Medicine 證據等級 */
export type EvidenceLevel = "I" | "II" | "III" | "IV" | "V";

export interface EnrichedCitation extends Citation {
  evidenceLevel?: EvidenceLevel;
  evidenceDescription?: string;
  crossReferences?: number[];  // IDs of related citations
  duplicateOf?: number;        // If this is a duplicate, ID of original
}

/**
 * Process raw citations from tool calls:
 * 1. Extract citations from RAG results
 * 2. Deduplicate overlapping content
 * 3. Assign evidence levels based on source type
 * 4. Cross-reference related citations
 */
export function processCitations(
  toolCalls: ToolCallRecord[]
): EnrichedCitation[] {
  const rawCitations = extractRawCitations(toolCalls);
  const deduped = deduplicateCitations(rawCitations);
  const enriched = assignEvidenceLevels(deduped);
  const crossReferenced = findCrossReferences(enriched);
  return crossReferenced;
}

/** Step 1: Extract raw citations from tool results */
function extractRawCitations(toolCalls: ToolCallRecord[]): EnrichedCitation[] {
  const citations: EnrichedCitation[] = [];
  let id = 1;

  for (const call of toolCalls) {
    if (call.name === "search_vet_literature" && Array.isArray(call.result)) {
      for (const doc of call.result as Array<Record<string, unknown>>) {
        citations.push({
          id: id++,
          title: (doc.title as string) || "Unknown",
          source: (doc.source as string) || "Unknown",
          year: doc.year as number | undefined,
          excerpt: ((doc.content as string) || "").substring(0, 300),
          similarity: doc.similarity as number | undefined,
        });
      }
    }
  }

  return citations;
}

/** Step 2: Deduplicate citations with similar content */
function deduplicateCitations(citations: EnrichedCitation[]): EnrichedCitation[] {
  const unique: EnrichedCitation[] = [];
  const contentFingerprints = new Map<string, number>();

  for (const citation of citations) {
    const fingerprint = generateFingerprint(citation.excerpt || "");

    if (contentFingerprints.has(fingerprint)) {
      // Mark as duplicate
      citation.duplicateOf = contentFingerprints.get(fingerprint);
    } else {
      contentFingerprints.set(fingerprint, citation.id);
      unique.push(citation);
    }
  }

  // Re-number unique citations
  unique.forEach((c, i) => { c.id = i + 1; });
  return unique;
}

/** Generate content fingerprint for deduplication */
function generateFingerprint(text: string): string {
  // Simple fingerprint: normalize whitespace, take first 100 chars
  return text.replace(/\s+/g, " ").trim().substring(0, 100).toLowerCase();
}

/** Step 3: Assign evidence levels based on source type */
function assignEvidenceLevels(citations: EnrichedCitation[]): EnrichedCitation[] {
  for (const citation of citations) {
    const source = (citation.source || "").toLowerCase();
    const title = (citation.title || "").toLowerCase();
    const content = (citation.excerpt || "").toLowerCase();

    if (containsAny(content, ["meta-analysis", "systematic review", "cochrane", "系統性回顧"])) {
      citation.evidenceLevel = "I";
      citation.evidenceDescription = "系統性回顧 / Meta-analysis";
    } else if (containsAny(content, ["randomized", "rct", "controlled trial", "隨機對照"])) {
      citation.evidenceLevel = "II";
      citation.evidenceDescription = "隨機對照試驗 (RCT)";
    } else if (containsAny(content, ["cohort", "case-control", "prospective", "retrospective", "世代研究"])) {
      citation.evidenceLevel = "III";
      citation.evidenceDescription = "非隨機對照研究";
    } else if (containsAny(content, ["case report", "case series", "病例報告"])) {
      citation.evidenceLevel = "IV";
      citation.evidenceDescription = "病例系列 / 專家意見";
    } else {
      // Default: textbook or clinical experience
      citation.evidenceLevel = "V";
      citation.evidenceDescription = "教科書 / 臨床經驗";
    }
  }

  return citations;
}

/** Step 4: Find cross-references between citations */
function findCrossReferences(citations: EnrichedCitation[]): EnrichedCitation[] {
  for (let i = 0; i < citations.length; i++) {
    const crossRefs: number[] = [];
    const wordsI = extractKeywords(citations[i].excerpt || "");

    for (let j = 0; j < citations.length; j++) {
      if (i === j) continue;
      const wordsJ = extractKeywords(citations[j].excerpt || "");
      const overlap = wordsI.filter(w => wordsJ.includes(w)).length;
      const overlapRatio = overlap / Math.max(wordsI.length, 1);

      // If >30% keyword overlap, consider cross-referenced
      if (overlapRatio > 0.3) {
        crossRefs.push(citations[j].id);
      }
    }

    if (crossRefs.length > 0) {
      citations[i].crossReferences = crossRefs;
    }
  }

  return citations;
}

/** Extract significant keywords from text */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "has", "have", "had", "do", "does", "did", "will", "would",
    "should", "can", "could", "may", "might", "of", "in", "to",
    "for", "with", "on", "at", "by", "from", "and", "or", "not",
    "this", "that", "these", "those",
    "的", "是", "在", "了", "和", "與", "為", "有", "不", "可",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

/** Helper: check if text contains any of the keywords */
function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some(k => text.includes(k.toLowerCase()));
}

/**
 * Format citations for display in the response
 */
export function formatCitationsForDisplay(citations: EnrichedCitation[]): string {
  if (citations.length === 0) return "";

  const lines: string[] = ["## 📚 引用來源\n"];

  for (const c of citations) {
    const level = c.evidenceLevel ? ` [Evidence Level ${c.evidenceLevel}]` : "";
    const year = c.year ? ` (${c.year})` : "";
    const crossRef = c.crossReferences?.length
      ? ` — 相關引用: [${c.crossReferences.join(", ")}]`
      : "";

    lines.push(`[${c.id}] ${c.title}${year} — ${c.source}${level}${crossRef}`);
  }

  return lines.join("\n");
}
