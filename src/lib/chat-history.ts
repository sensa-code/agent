// ============================================================================
// 對話歷史管理 — Supabase vet_ai schema
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getAdminClient() {
  return createClient(supabaseUrl, supabaseKey, {
    db: { schema: "vet_ai" },
  });
}

// ============================================================================
// Conversations
// ============================================================================

export async function createConversation(userId: string, title?: string) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      title: title || "新對話",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data;
}

export async function getConversation(conversationId: string) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (error) return null;
  return data;
}

export async function listConversations(userId: string, limit = 20) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, model, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list conversations: ${error.message}`);
  return data || [];
}

export async function updateConversationTitle(conversationId: string, title: string) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", conversationId);

  if (error) throw new Error(`Failed to update conversation: ${error.message}`);
}

// ============================================================================
// Messages
// ============================================================================

export async function saveMessage(params: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: unknown;
  citations?: unknown;
  tokenUsage?: unknown;
  latencyMs?: number;
}) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      tool_calls: params.toolCalls || null,
      citations: params.citations || null,
      token_usage: params.tokenUsage || null,
      latency_ms: params.latencyMs || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save message: ${error.message}`);
  return data;
}

export async function getMessages(conversationId: string, limit = 100) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to get messages: ${error.message}`);
  return data || [];
}

// ============================================================================
// Usage Logs
// ============================================================================

export async function logUsage(params: {
  userId?: string;
  conversationId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolsUsed?: string[];
  ragQueries?: number;
}) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("usage_logs")
    .insert({
      user_id: params.userId || null,
      conversation_id: params.conversationId || null,
      model: params.model,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      tools_used: params.toolsUsed || [],
      rag_queries: params.ragQueries || 0,
    });

  if (error) {
    console.error("Failed to log usage:", error);
    // Don't throw — usage logging is not critical
  }
}
