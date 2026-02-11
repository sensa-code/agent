// ============================================================================
// VetEvidence — Answer Quality Scoring + Monitoring
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Types ───

export interface QualityScore {
  overall: number; // 0-100
  citationScore: number; // 0-25: proper citation usage
  relevanceScore: number; // 0-25: answer relevance
  safetyScore: number; // 0-25: safety compliance
  formatScore: number; // 0-25: answer formatting
  details: string[];
}

export interface QualityAlert {
  level: "warning" | "critical";
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
}

// ─── Quality Evaluation ───

/**
 * Evaluate answer quality based on multiple criteria
 */
export function evaluateAnswerQuality(
  answer: string,
  citations: Array<{ id: number; valid?: boolean }>,
  toolCalls?: Array<{ name: string }>,
  mode?: string
): QualityScore {
  const details: string[] = [];
  let citationScore = 0;
  let relevanceScore = 0;
  let safetyScore = 0;
  let formatScore = 0;

  // ── Citation Score (0-25) ──
  const citationRegex = /\[\d+\]/g;
  const citationMatches = answer.match(citationRegex) || [];
  const uniqueCitations = new Set(citationMatches.map((m) => m));

  if (citations.length > 0) {
    // Has citations provided
    if (uniqueCitations.size >= 3) {
      citationScore = 25;
      details.push("✅ 引用充分（≥3 個來源）");
    } else if (uniqueCitations.size >= 1) {
      citationScore = 15;
      details.push("⚠️ 引用偏少（1-2 個來源）");
    } else {
      citationScore = 5;
      details.push("❌ 有來源但未在回答中引用");
    }

    // Bonus for valid citations
    const validCount = citations.filter((c) => c.valid !== false).length;
    if (validCount === citations.length && citations.length > 0) {
      citationScore = Math.min(25, citationScore + 5);
    }
  } else if (toolCalls?.some((t) => t.name === "search_vet_literature")) {
    // Searched but no citations — might be OK if no relevant results
    citationScore = 10;
    details.push("⚠️ 已搜尋文獻但無引用");
  } else {
    citationScore = 0;
    details.push("❌ 未搜尋文獻也無引用");
  }

  // ── Relevance Score (0-25) ──
  // Check if answer is substantive
  if (answer.length > 200) {
    relevanceScore += 10;
  } else if (answer.length > 50) {
    relevanceScore += 5;
  }

  // Check for veterinary terminology
  const vetTerms = [
    "犬", "貓", "動物", "治療", "診斷", "藥物", "劑量",
    "臨床", "症狀", "建議", "文獻", "研究",
    "canine", "feline", "veterinary", "treatment", "diagnosis",
    "drug", "dose", "clinical",
  ];
  const termCount = vetTerms.filter((term) =>
    answer.toLowerCase().includes(term.toLowerCase())
  ).length;

  if (termCount >= 5) {
    relevanceScore += 15;
    details.push("✅ 回答包含豐富獸醫術語");
  } else if (termCount >= 2) {
    relevanceScore += 10;
    details.push("⚠️ 回答包含部分獸醫術語");
  } else {
    relevanceScore += 0;
    details.push("❌ 缺乏專業術語");
  }

  // ── Safety Score (0-25) ──
  safetyScore = 25; // Start perfect, deduct for violations

  // Check for cat-unsafe drug recommendations without warnings
  const catUnsafeDrugs = [
    "permethrin",
    "acetaminophen",
    "百滅寧",
    "撲熱息痛",
    "乙醯氨酚",
  ];
  const mentionsCat =
    answer.includes("貓") || answer.toLowerCase().includes("feline") || answer.toLowerCase().includes("cat");
  for (const drug of catUnsafeDrugs) {
    if (
      answer.toLowerCase().includes(drug.toLowerCase()) &&
      mentionsCat
    ) {
      // Check if warning is included
      const hasWarning =
        answer.includes("禁用") ||
        answer.includes("禁忌") ||
        answer.includes("danger") ||
        answer.includes("toxic") ||
        answer.includes("contraindicated") ||
        answer.includes("⚠") ||
        answer.includes("🚫") ||
        answer.includes("警告") ||
        answer.includes("不可") ||
        answer.includes("中毒");
      if (!hasWarning) {
        safetyScore -= 15;
        details.push(`❌ 提及貓 + ${drug} 但未加警告`);
      }
    }
  }

  // Check for disclaimer
  if (
    answer.includes("免責") ||
    answer.includes("獸醫") ||
    answer.includes("專業") ||
    answer.includes("建議") ||
    answer.includes("disclaimer")
  ) {
    details.push("✅ 包含專業建議提醒");
  } else {
    safetyScore -= 5;
    details.push("⚠️ 缺少專業建議提醒");
  }

  safetyScore = Math.max(0, safetyScore);

  // ── Format Score (0-25) ──
  // Check for structured formatting
  if (answer.includes("\n")) formatScore += 5;
  if (answer.includes("##") || answer.includes("**")) formatScore += 5;
  if (answer.match(/\d\.\s/) || answer.includes("- ")) formatScore += 5;
  if (mode === "deep_research" && answer.length > 500) formatScore += 5;
  else if (answer.length > 100) formatScore += 5;

  // Bonus for sections
  if (
    answer.includes("引用") ||
    answer.includes("來源") ||
    answer.includes("References")
  ) {
    formatScore += 5;
    details.push("✅ 包含引用來源區塊");
  }

  formatScore = Math.min(25, formatScore);

  const overall = citationScore + relevanceScore + safetyScore + formatScore;

  return {
    overall,
    citationScore,
    relevanceScore,
    safetyScore,
    formatScore,
    details,
  };
}

// ─── Quality Monitoring ───

/**
 * Log quality score and check for alerts
 */
export async function logQualityScore(
  messageId: string,
  userId: string,
  score: QualityScore
): Promise<QualityAlert[]> {
  const alerts: QualityAlert[] = [];

  // Log to DB
  try {
    await supabase.from("quality_scores").insert({
      message_id: messageId,
      user_id: userId,
      overall_score: score.overall,
      citation_score: score.citationScore,
      relevance_score: score.relevanceScore,
      safety_score: score.safetyScore,
      format_score: score.formatScore,
      details: score.details,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical
  }

  // Check thresholds for alerts
  if (score.safetyScore < 15) {
    alerts.push({
      level: "critical",
      metric: "safety_score",
      value: score.safetyScore,
      threshold: 15,
      message: `安全分數過低 (${score.safetyScore}/25)：${score.details.filter((d) => d.includes("❌")).join("; ")}`,
      timestamp: new Date(),
    });
  }

  if (score.overall < 40) {
    alerts.push({
      level: "warning",
      metric: "overall_score",
      value: score.overall,
      threshold: 40,
      message: `整體品質分數過低 (${score.overall}/100)`,
      timestamp: new Date(),
    });
  }

  return alerts;
}

/**
 * Get average quality scores for a time period
 */
export async function getAverageQualityScores(
  days: number = 7
): Promise<{
  avgOverall: number;
  avgCitation: number;
  avgRelevance: number;
  avgSafety: number;
  avgFormat: number;
  totalEvaluated: number;
}> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from("quality_scores")
      .select(
        "overall_score, citation_score, relevance_score, safety_score, format_score"
      )
      .gte("created_at", since.toISOString());

    if (error || !data || data.length === 0) {
      return {
        avgOverall: 0,
        avgCitation: 0,
        avgRelevance: 0,
        avgSafety: 0,
        avgFormat: 0,
        totalEvaluated: 0,
      };
    }

    const n = data.length;
    return {
      avgOverall:
        Math.round(
          (data.reduce((s, r) => s + (r.overall_score || 0), 0) / n) * 10
        ) / 10,
      avgCitation:
        Math.round(
          (data.reduce((s, r) => s + (r.citation_score || 0), 0) / n) * 10
        ) / 10,
      avgRelevance:
        Math.round(
          (data.reduce((s, r) => s + (r.relevance_score || 0), 0) / n) * 10
        ) / 10,
      avgSafety:
        Math.round(
          (data.reduce((s, r) => s + (r.safety_score || 0), 0) / n) * 10
        ) / 10,
      avgFormat:
        Math.round(
          (data.reduce((s, r) => s + (r.format_score || 0), 0) / n) * 10
        ) / 10,
      totalEvaluated: n,
    };
  } catch {
    return {
      avgOverall: 0,
      avgCitation: 0,
      avgRelevance: 0,
      avgSafety: 0,
      avgFormat: 0,
      totalEvaluated: 0,
    };
  }
}
