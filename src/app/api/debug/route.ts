// Temporary debug endpoint - check env vars and RAG connectivity
// DELETE THIS AFTER DEBUGGING

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { searchVetLiterature } from "@/lib/tools/search-vet-literature";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, unknown> = {};

  // 1. Check env vars (only show existence and length, never values)
  checks.env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
      ? `SET (${process.env.OPENAI_API_KEY.length} chars, starts: ${process.env.OPENAI_API_KEY.substring(0, 7)}...)`
      : "MISSING",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `SET (${process.env.NEXT_PUBLIC_SUPABASE_URL.length} chars)`
      : "MISSING",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? `SET (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)`
      : "MISSING",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
      ? `SET (${process.env.ANTHROPIC_API_KEY.length} chars, starts: ${process.env.ANTHROPIC_API_KEY.substring(0, 7)}...)`
      : "MISSING",
  };

  // 2. Test OpenAI embedding
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && openaiKey.length > 10) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: "test",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        checks.openai_embedding = {
          status: "OK",
          vector_length: data.data[0].embedding.length,
        };
      } else {
        const errText = await res.text();
        checks.openai_embedding = {
          status: "ERROR",
          http_status: res.status,
          error: errText.substring(0, 200),
        };
      }
    } catch (err) {
      checks.openai_embedding = {
        status: "EXCEPTION",
        error: String(err),
      };
    }
  } else {
    checks.openai_embedding = { status: "SKIPPED", reason: "No valid OPENAI_API_KEY" };
  }

  // 3. Test Supabase RPC
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const randomVec = new Array(1536).fill(0).map(() => Math.random() - 0.5);
      const norm = Math.sqrt(randomVec.reduce((s, v) => s + v * v, 0));
      const normalizedVec = randomVec.map((v) => v / norm);

      const { data, error } = await supabase.rpc("rag_match_documents", {
        query_embedding: normalizedVec,
        match_count: 2,
        match_threshold: 0.0,
        filter_category: null,
        filter_species: null,
      });

      if (error) {
        checks.supabase_rag = { status: "ERROR", error: error.message };
      } else {
        checks.supabase_rag = {
          status: "OK",
          results: data?.length || 0,
          titles: data?.map((d: Record<string, unknown>) => d.title) || [],
        };
      }
    } catch (err) {
      checks.supabase_rag = { status: "EXCEPTION", error: String(err) };
    }
  } else {
    checks.supabase_rag = { status: "SKIPPED", reason: "Missing Supabase env" };
  }

  // 4. Test searchVetLiterature function directly (same as tool call)
  try {
    const ragResults = await searchVetLiterature({
      query: "canine CKD treatment",
      species: "canine",
      max_results: 2,
    });
    checks.search_vet_literature = {
      status: "OK",
      results: ragResults.length,
      data: ragResults.map((r) => ({
        title: r.title,
        similarity: r.similarity,
        source: r.source,
      })),
    };
  } catch (err) {
    checks.search_vet_literature = {
      status: "EXCEPTION",
      error: String(err),
    };
  }

  // 5. Test: manual embedding + RPC with threshold 0.5 (same as search-vet-literature.ts)
  if (openaiKey && supabaseUrl && supabaseKey) {
    try {
      // Generate embedding
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: "canine CKD treatment",
        }),
      });
      const embData = await embRes.json();
      const embedding = embData.data[0].embedding;

      // Same RPC call as search-vet-literature.ts
      const supabase = createClient(supabaseUrl!, supabaseKey!);
      const { data: rpcData, error: rpcErr } = await supabase.rpc("rag_match_documents", {
        query_embedding: embedding,
        match_count: 2,
        match_threshold: 0.5,
        filter_category: null,
        filter_species: null,
      });

      checks.manual_rag_test = {
        status: rpcErr ? "ERROR" : "OK",
        error: rpcErr?.message,
        embedding_length: embedding.length,
        results: rpcData?.length || 0,
        data: (rpcData || []).map((d: Record<string, unknown>) => ({
          title: d.title,
          similarity: d.similarity,
        })),
      };

      // Also test with species filter = "canine" (which searchVetLiterature would pass)
      const { data: rpcData2, error: rpcErr2 } = await supabase.rpc("rag_match_documents", {
        query_embedding: embedding,
        match_count: 2,
        match_threshold: 0.5,
        filter_category: null,
        filter_species: "canine",
      });

      checks.manual_rag_with_species = {
        status: rpcErr2 ? "ERROR" : "OK",
        error: rpcErr2?.message,
        results: rpcData2?.length || 0,
        data: (rpcData2 || []).map((d: Record<string, unknown>) => ({
          title: d.title,
          similarity: d.similarity,
        })),
      };
    } catch (err) {
      checks.manual_rag_test = { status: "EXCEPTION", error: String(err) };
    }
  }

  return NextResponse.json(checks);
}
