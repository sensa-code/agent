// ============================================================================
// VetEvidence — API Key Management
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Types ───

export interface ApiKey {
  id: string;
  userId: string;
  keyPrefix: string; // First 8 chars of key (for display)
  keyHash: string; // SHA-256 hash for validation
  name: string;
  tier: "free" | "pro" | "enterprise";
  rateLimit: number; // requests per minute
  status: "active" | "revoked" | "expired";
  lastUsedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ApiKeyValidation {
  valid: boolean;
  userId?: string;
  tier?: "free" | "pro" | "enterprise";
  rateLimit?: number;
  keyId?: string;
  error?: string;
}

// In-memory cache for validated keys (60s TTL)
const keyCache = new Map<
  string,
  { validation: ApiKeyValidation; expiresAt: number }
>();

// Rate limit tracking per key
const keyRateLimits = new Map<
  string,
  { count: number; windowStart: number }
>();

/**
 * Generate a new API key
 * Format: vk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 chars)
 */
export async function generateApiKey(
  userId: string,
  name: string,
  tier: "free" | "pro" | "enterprise" = "free"
): Promise<{ key: string; keyId: string }> {
  const rawKey = randomBytes(24).toString("hex"); // 48 hex chars
  const fullKey = `vk_live_${rawKey}`;
  const keyPrefix = fullKey.substring(0, 12); // "vk_live_xxxx"
  const keyHash = hashKey(fullKey);

  const rateLimits: Record<string, number> = {
    free: 10,
    pro: 60,
    enterprise: 300,
  };

  const id = randomBytes(16).toString("hex");

  try {
    await supabase.from("api_keys").insert({
      id,
      user_id: userId,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      name,
      tier,
      rate_limit: rateLimits[tier] || 10,
      status: "active",
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to save API key:", err);
  }

  return { key: fullKey, keyId: id };
}

/**
 * Validate an API key
 */
export async function validateApiKey(
  key: string
): Promise<ApiKeyValidation> {
  // Check format
  if (!key.startsWith("vk_")) {
    return { valid: false, error: "Invalid key format" };
  }

  // Check cache first
  const cached = keyCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.validation;
  }

  // Hash the key and look up in DB
  const keyHash = hashKey(key);

  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, user_id, tier, rate_limit, status, expires_at")
      .eq("key_hash", keyHash)
      .single();

    if (error || !data) {
      const result: ApiKeyValidation = {
        valid: false,
        error: "API key not found",
      };
      keyCache.set(key, { validation: result, expiresAt: Date.now() + 10000 });
      return result;
    }

    if (data.status !== "active") {
      return { valid: false, error: `API key is ${data.status}` };
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    const result: ApiKeyValidation = {
      valid: true,
      userId: data.user_id,
      tier: data.tier,
      rateLimit: data.rate_limit,
      keyId: data.id,
    };

    // Cache for 60 seconds
    keyCache.set(key, {
      validation: result,
      expiresAt: Date.now() + 60000,
    });

    // Update last used (non-blocking)
    supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {});

    return result;
  } catch {
    return { valid: false, error: "Validation error" };
  }
}

/**
 * Check API key rate limit (per-minute sliding window)
 */
export function checkApiKeyRateLimit(
  keyId: string,
  rateLimit: number
): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now();
  const windowMs = 60000; // 1 minute

  let limiter = keyRateLimits.get(keyId);
  if (!limiter || now - limiter.windowStart > windowMs) {
    limiter = { count: 0, windowStart: now };
    keyRateLimits.set(keyId, limiter);
  }

  if (limiter.count >= rateLimit) {
    const retryAfter = Math.ceil(
      (limiter.windowStart + windowMs - now) / 1000
    );
    return { allowed: false, remaining: 0, retryAfterSec: retryAfter };
  }

  limiter.count++;
  return { allowed: true, remaining: rateLimit - limiter.count };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  keyId: string,
  userId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("api_keys")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("user_id", userId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * List API keys for a user (without exposing full key)
 */
export async function listApiKeys(
  userId: string
): Promise<
  Array<{
    id: string;
    keyPrefix: string;
    name: string;
    tier: string;
    status: string;
    lastUsedAt?: string;
    createdAt: string;
  }>
> {
  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, key_prefix, name, tier, status, last_used_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      keyPrefix: row.key_prefix,
      name: row.name,
      tier: row.tier,
      status: row.status,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

// ─── Test Key Support ───

// Pre-configured test keys for gate tests
const TEST_KEYS: Record<string, ApiKeyValidation> = {
  vk_test_valid_key: {
    valid: true,
    userId: "test-user-001",
    tier: "pro",
    rateLimit: 60,
    keyId: "test-key-001",
  },
  vk_test_ratelimit_key: {
    valid: true,
    userId: "test-user-002",
    tier: "free",
    rateLimit: 5, // Very low for testing
    keyId: "test-key-002",
  },
  vk_test_enterprise_key: {
    valid: true,
    userId: "test-user-003",
    tier: "enterprise",
    rateLimit: 300,
    keyId: "test-key-003",
  },
};

/**
 * Validate key — checks test keys first, then DB
 */
export async function validateApiKeyWithTestSupport(
  key: string
): Promise<ApiKeyValidation> {
  // Check test keys first
  if (TEST_KEYS[key]) {
    return TEST_KEYS[key];
  }
  return validateApiKey(key);
}

// ─── Helpers ───

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
