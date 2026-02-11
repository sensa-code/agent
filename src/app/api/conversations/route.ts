// ============================================================================
// Conversations API — 對話歷史管理
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createConversation,
  listConversations,
  getMessages,
  saveMessage,
} from "@/lib/chat-history";

/** 從 Authorization header 取得使用者 */
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  return user;
}

/** GET: 列出使用者的對話歷史 */
export async function GET(request: NextRequest) {
  const user = await getUserFromToken(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id");

    if (conversationId) {
      // 取得特定對話的訊息
      const messages = await getMessages(conversationId);
      return NextResponse.json({ messages });
    }

    // 列出所有對話
    const conversations = await listConversations(user.id);
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("Conversations GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** POST: 建立新對話 */
export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title } = body;

    const conversation = await createConversation(user.id, title);
    return NextResponse.json({ conversation });
  } catch (err) {
    console.error("Conversations POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
