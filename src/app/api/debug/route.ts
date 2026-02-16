// Temporary debug endpoint — DELETE after debugging
import { NextResponse } from "next/server";
import { searchVetLiterature } from "@/lib/tools/search-vet-literature";

export async function GET() {
  try {
    // 1. Check env vars
    const envCheck = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `set (${process.env.OPENAI_API_KEY.length} chars, ends with: "${process.env.OPENAI_API_KEY.slice(-5)}")` : "NOT SET",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? `set (${process.env.NEXT_PUBLIC_SUPABASE_URL.length} chars)` : "NOT SET",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? `set (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)` : "NOT SET",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? `set (${process.env.ANTHROPIC_API_KEY.length} chars)` : "NOT SET",
    };

    // 2. Test searchVetLiterature directly
    const searchResult = await searchVetLiterature({
      query: "canine CKD treatment",
      max_results: 3,
    });

    // 3. Check if result is array
    const isArray = Array.isArray(searchResult);
    const resultLength = isArray ? searchResult.length : -1;

    return NextResponse.json({
      envCheck,
      searchResult: {
        isArray,
        length: resultLength,
        firstItem: isArray && searchResult.length > 0 ? {
          id: searchResult[0].id,
          title: searchResult[0].title,
          source: searchResult[0].source,
          similarity: searchResult[0].similarity,
        } : null,
      },
      rawType: typeof searchResult,
    });
  } catch (err) {
    return NextResponse.json({
      error: String(err),
      stack: (err as Error).stack?.substring(0, 500),
    }, { status: 500 });
  }
}
