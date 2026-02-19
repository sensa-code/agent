// ============================================================================
// VETPRO Client — HTTP client for VetPro veterinary encyclopedia API
// Features: timeout, retry, circuit breaker
// ============================================================================

import type {
  VetproSearchResult,
  VetproDiseaseDetail,
  VetproDrugListItem,
  VetproDrugDetail,
  VetproInteraction,
  VetproDDXResult,
  VetproSymptom,
  VetproLabFinding,
} from "./types";

// ─── Configuration ───

const VETPRO_BASE_URL = (process.env.VETPRO_BASE_URL || "").replace(/\/$/, "");
const VETPRO_API_KEY = process.env.VETPRO_API_KEY || "";
const REQUEST_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;

// ─── Circuit Breaker ───

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  isOpen: false,
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

function checkCircuitBreaker(): boolean {
  if (!circuitBreaker.isOpen) return true;

  // Check if cooldown has passed → half-open state (allow probe)
  if (Date.now() - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_COOLDOWN_MS) {
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    return true;
  }

  return false; // Circuit is open, reject request
}

function recordSuccess(): void {
  circuitBreaker.failures = 0;
  circuitBreaker.isOpen = false;
}

function recordFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.isOpen = true;
    console.warn(`[vetpro-client] Circuit breaker OPEN after ${circuitBreaker.failures} failures. Cooldown ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s.`);
  }
}

// ─── HTTP Helper ───

async function vetproFetch<T>(path: string, retries = MAX_RETRIES): Promise<T> {
  if (!VETPRO_BASE_URL) {
    throw new Error("VETPRO_BASE_URL not configured");
  }

  if (!checkCircuitBreaker()) {
    throw new Error("VETPRO circuit breaker is open — service temporarily unavailable");
  }

  const url = `${VETPRO_BASE_URL}/api/v1${path}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": VETPRO_API_KEY,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`VETPRO ${response.status}: ${errorText}`);
      }

      const data = await response.json() as T;
      recordSuccess();
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on 4xx errors (client errors)
      if (lastError.message.includes("VETPRO 4")) {
        recordFailure();
        throw lastError;
      }

      if (attempt < retries) {
        // Brief delay before retry
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  recordFailure();
  throw lastError || new Error("VETPRO request failed");
}

// ─── Public API ───

/**
 * Cross-search diseases + drugs via FTS5
 * GET /api/v1/search?q=CKD
 */
export async function search(query: string): Promise<VetproSearchResult> {
  const q = encodeURIComponent(query.trim());
  return vetproFetch<VetproSearchResult>(`/search?q=${q}`);
}

/**
 * Get full disease detail by slug
 * GET /api/v1/diseases/:slug
 */
export async function getDiseaseDetail(slug: string): Promise<VetproDiseaseDetail> {
  return vetproFetch<VetproDiseaseDetail>(`/diseases/${encodeURIComponent(slug)}`);
}

/**
 * Search drugs by name/classification
 * GET /api/v1/drugs?q=metronidazole
 */
export async function searchDrugs(
  query: string,
  options?: { species?: string; classification?: string }
): Promise<{ total: number; drugs: VetproDrugListItem[] }> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (options?.species) params.set("species", options.species);
  if (options?.classification) params.set("classification", options.classification);
  return vetproFetch(`/drugs?${params.toString()}`);
}

/**
 * Get full drug detail by slug
 * GET /api/v1/drugs/:slug
 */
export async function getDrugDetail(slug: string): Promise<VetproDrugDetail> {
  return vetproFetch<VetproDrugDetail>(`/drugs/${encodeURIComponent(slug)}`);
}

/**
 * Check drug interactions
 * GET /api/v1/drugs/interactions?drugs=D0001,D0034
 */
export async function checkInteractions(
  drugIds: string[]
): Promise<{ interactionCount: number; interactions: VetproInteraction[] }> {
  const ids = drugIds.join(",");
  return vetproFetch(`/drugs/interactions?drugs=${ids}`);
}

/**
 * Search symptoms by keyword (for DDX symptom ID resolution)
 * GET /api/v1/symptoms?q=vomiting
 */
export async function searchSymptoms(query: string): Promise<VetproSymptom[]> {
  const q = encodeURIComponent(query.trim());
  return vetproFetch<VetproSymptom[]>(`/symptoms?q=${q}`);
}

/**
 * Search lab findings by keyword (for DDX lab ID resolution)
 * GET /api/v1/lab-findings?q=azotaemia
 */
export async function searchLabFindings(query: string): Promise<VetproLabFinding[]> {
  const q = encodeURIComponent(query.trim());
  return vetproFetch<VetproLabFinding[]>(`/lab-findings?q=${q}`);
}

/**
 * Differential diagnosis query
 * GET /api/v1/ddx?symptoms=vomiting,diarrhoea&labs=azotaemia&species=dog
 */
export async function getDDX(
  symptomIds: string[],
  labIds: string[],
  options?: { species?: string; exclude?: string[] }
): Promise<{ resultCount: number; results: VetproDDXResult[] }> {
  const params = new URLSearchParams();
  if (symptomIds.length > 0) params.set("symptoms", symptomIds.join(","));
  if (labIds.length > 0) params.set("labs", labIds.join(","));
  if (options?.species) params.set("species", options.species);
  if (options?.exclude && options.exclude.length > 0) {
    params.set("exclude", options.exclude.join(","));
  }
  return vetproFetch(`/ddx?${params.toString()}`);
}

/**
 * Check if VETPRO is configured and reachable
 */
export function isConfigured(): boolean {
  return Boolean(VETPRO_BASE_URL && VETPRO_API_KEY);
}

/**
 * Check circuit breaker status (for debugging/monitoring)
 */
export function getCircuitBreakerStatus(): { isOpen: boolean; failures: number } {
  return {
    isOpen: circuitBreaker.isOpen,
    failures: circuitBreaker.failures,
  };
}
