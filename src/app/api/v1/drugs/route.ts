// ============================================================================
// VetEvidence — External REST API: /api/v1/drugs
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  validateApiKeyWithTestSupport,
  checkApiKeyRateLimit,
} from "@/lib/api/api-key-manager";
import { drugLookup } from "@/lib/tools/drug-lookup";

export const runtime = "nodejs";

/**
 * GET /api/v1/drugs?name=Amoxicillin&species=canine
 *
 * Headers:
 *   Authorization: Bearer vk_live_xxxxx
 *
 * Response:
 *   { "drug_name": "Amoxicillin", "results": [...] }
 */
export async function GET(request: NextRequest) {
  try {
    // ── 1. Validate API key ──
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const apiKey = authHeader.replace("Bearer ", "").trim();
    const validation = await validateApiKeyWithTestSupport(apiKey);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid API key" },
        { status: 401 }
      );
    }

    // ── 2. Rate limit ──
    const rateCheck = checkApiKeyRateLimit(
      validation.keyId!,
      validation.rateLimit || 10
    );
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }

    // ── 3. Parse query parameters ──
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");
    const species = searchParams.get("species") || undefined;
    const infoType = searchParams.get("info_type") || "full";

    if (!name) {
      return NextResponse.json(
        { error: "name query parameter is required" },
        { status: 400 }
      );
    }

    // ── 4. Look up drug ──
    const result = await drugLookup({
      drug_name: name,
      species,
      info_type: infoType,
    });

    return NextResponse.json({
      drug_name: name,
      found: result.found,
      results: result.results,
      species: species || "all",
    });
  } catch (error) {
    console.error("API v1 drugs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
