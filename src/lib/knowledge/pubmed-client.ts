// ============================================================================
// PubMed Client — E-utilities ESearch + EFetch
// Free API: 3 req/s (no key), 10 req/s (with API key)
// ============================================================================

import type { KnowledgeItem, PubMedArticle } from "./types";

const PUBMED_API_KEY = process.env.PUBMED_API_KEY || "";
const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const REQUEST_TIMEOUT_MS = 6000;

// ─── ESearch: get PMIDs ───

async function esearch(
  query: string,
  maxResults: number = 5
): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    retmax: String(maxResults),
    sort: "relevance",
    term: `${query} AND veterinary[sb]`, // veterinary subset filter
  });
  if (PUBMED_API_KEY) params.set("api_key", PUBMED_API_KEY);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ESEARCH_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[pubmed-client] ESearch error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data?.esearchresult?.idlist || [];
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("[pubmed-client] ESearch failed:", err);
    return [];
  }
}

// ─── EFetch: get article details (XML) ───

async function efetch(pmids: string[]): Promise<PubMedArticle[]> {
  if (pmids.length === 0) return [];

  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "xml",
    rettype: "abstract",
    id: pmids.join(","),
  });
  if (PUBMED_API_KEY) params.set("api_key", PUBMED_API_KEY);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${EFETCH_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[pubmed-client] EFetch error: ${response.status}`);
      return [];
    }

    const xmlText = await response.text();
    return parseArticlesFromXml(xmlText);
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("[pubmed-client] EFetch failed:", err);
    return [];
  }
}

// ─── Lightweight XML parsing (no dependency needed) ───

function parseArticlesFromXml(xml: string): PubMedArticle[] {
  const articles: PubMedArticle[] = [];

  // Split by <PubmedArticle> blocks
  const articleBlocks = xml.split(/<PubmedArticle[^>]*>/);

  for (let i = 1; i < articleBlocks.length; i++) {
    const block = articleBlocks[i];

    try {
      const pmid = extractTag(block, "PMID") || "";
      const title = extractTag(block, "ArticleTitle") || "";

      // Extract abstract text blocks
      const abstractTexts: string[] = [];
      const abstractMatches = block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g);
      for (const m of abstractMatches) {
        abstractTexts.push(stripTags(m[1]).trim());
      }
      const abstract = abstractTexts.join(" ").substring(0, 500);

      // Extract authors (LastName + Initials)
      const authors: string[] = [];
      const authorMatches = block.matchAll(/<Author[^>]*>[\s\S]*?<LastName>(.*?)<\/LastName>[\s\S]*?<Initials>(.*?)<\/Initials>[\s\S]*?<\/Author>/g);
      for (const m of authorMatches) {
        authors.push(`${m[1]} ${m[2]}`);
        if (authors.length >= 3) break; // Max 3 authors
      }

      // Extract journal
      const journal = extractTag(block, "Title") || extractTag(block, "ISOAbbreviation") || "";

      // Extract year
      const yearStr =
        extractTagFromContext(block, "PubDate", "Year") ||
        extractTagFromContext(block, "PubMedPubDate", "Year");
      const year = yearStr ? parseInt(yearStr, 10) : 0;

      // Extract DOI
      const doiMatch = block.match(/<ArticleId IdType="doi">(.*?)<\/ArticleId>/);
      const doi = doiMatch ? doiMatch[1] : undefined;

      if (pmid && title) {
        articles.push({ pmid, title: stripTags(title), abstract, authors, journal, year, doi });
      }
    } catch {
      // Skip unparseable articles
      continue;
    }
  }

  return articles;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "s"));
  return match ? match[1].trim() : null;
}

function extractTagFromContext(xml: string, contextTag: string, innerTag: string): string | null {
  const ctxMatch = xml.match(new RegExp(`<${contextTag}[^>]*>([\\s\\S]*?)</${contextTag}>`));
  if (!ctxMatch) return null;
  return extractTag(ctxMatch[1], innerTag);
}

function stripTags(str: string): string {
  return str.replace(/<[^>]+>/g, "").trim();
}

// ─── Public API ───

/**
 * Search PubMed and return standardized KnowledgeItems
 */
export async function search(
  query: string,
  options?: { maxResults?: number }
): Promise<KnowledgeItem[]> {
  const maxResults = options?.maxResults || 5;

  try {
    // Step 1: ESearch to get PMIDs
    const pmids = await esearch(query, maxResults);
    if (pmids.length === 0) return [];

    // Step 2: EFetch to get article details
    const articles = await efetch(pmids);

    // Step 3: Convert to KnowledgeItem[]
    return articles.map((article) => ({
      source: "pubmed" as const,
      title: article.title,
      content: article.abstract || "(No abstract available)",
      year: article.year || undefined,
      relevanceScore: 0, // Will be weighted by merger
      citation: {
        title: article.title,
        source: article.journal || "PubMed",
        year: article.year || undefined,
        pmid: article.pmid,
        journal: article.journal,
        url: `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
        sourceType: "pubmed" as const,
      },
    }));
  } catch (err) {
    console.error("[pubmed-client] Search failed:", err);
    return [];
  }
}

/**
 * Check if PubMed is available (always true, but with/without API key)
 */
export function isConfigured(): boolean {
  return true; // PubMed is freely accessible
}
