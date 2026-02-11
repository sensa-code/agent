-- ============================================================================
-- VetEvidence Schema — 獸醫 AI Agent 專用 schema
-- ============================================================================
-- 與同一 Supabase 專案共存，透過 schema 隔離：
--   public  → DRUGAPI 平台（drugs, user_profiles, search_history 等）
--   rag     → RAG 知識庫（documents, books — 183K+ 向量文件）
--   vet_ai  → VetEvidence Agent（本檔案）
-- ============================================================================

-- ====================================
-- 1. 建立 vet_ai schema
-- ====================================
CREATE SCHEMA IF NOT EXISTS vet_ai;

-- 授權 PostgREST 角色可以存取此 schema
GRANT USAGE ON SCHEMA vet_ai TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA vet_ai TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vet_ai TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA vet_ai TO anon, authenticated, service_role;

-- 設定預設權限（未來新增的表也自動授權）
ALTER DEFAULT PRIVILEGES IN SCHEMA vet_ai
GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA vet_ai
GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA vet_ai
GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ====================================
-- 2. 對話記錄表
-- ====================================
CREATE TABLE vet_ai.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,                          -- 對話標題（自動從首次提問生成）
    model TEXT DEFAULT 'claude-sonnet-4-5-20250929',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vet_ai.conversations IS 'Agent 對話 session 記錄';

-- ====================================
-- 3. 對話訊息表
-- ====================================
CREATE TABLE vet_ai.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES vet_ai.conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,

    -- Tool 使用記錄
    tool_calls JSONB,                    -- Agent 呼叫的 tools [{name, input, result}]

    -- 引用來源
    citations JSONB,                     -- [{id, title, source, year, excerpt, similarity}]

    -- Metadata
    token_usage JSONB,                   -- {input_tokens, output_tokens}
    latency_ms INTEGER,                  -- 回應延遲（毫秒）

    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vet_ai.messages IS 'Agent 對話訊息（含 tool calls 和引用）';

-- ====================================
-- 4. 使用量追蹤表
-- ====================================
CREATE TABLE vet_ai.usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES vet_ai.conversations(id) ON DELETE SET NULL,

    -- API 使用量
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,

    -- Tool 使用統計
    tools_used TEXT[],                   -- ['search_vet_literature', 'drug_lookup']
    rag_queries INTEGER DEFAULT 0,       -- RAG 查詢次數

    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vet_ai.usage_logs IS 'API 用量追蹤（Token 消耗、Tool 使用統計）';

-- ====================================
-- 5. 臨床 Protocol / SOP 表
-- ====================================
CREATE TABLE vet_ai.protocols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 基本資訊
    condition TEXT NOT NULL,             -- 疾病/臨床情境名稱
    title TEXT NOT NULL,                 -- Protocol 標題

    -- 分類
    protocol_type TEXT NOT NULL CHECK (protocol_type IN (
        'diagnosis', 'treatment', 'emergency', 'prevention', 'monitoring'
    )),
    species TEXT[] DEFAULT '{}',         -- 適用物種

    -- 內容
    content TEXT NOT NULL,               -- Protocol 完整內容（Markdown）
    steps JSONB,                         -- 結構化步驟 [{order, title, description, warnings}]

    -- 來源
    source TEXT,                         -- 來源（教科書、指引等）
    source_year INTEGER,                 -- 出版年份

    -- Metadata
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vet_ai.protocols IS '臨床標準作業流程 (SOP) 和治療指引';

-- ====================================
-- 6. 使用者回饋表（Agent 品質改善用）
-- ====================================
CREATE TABLE vet_ai.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    message_id UUID REFERENCES vet_ai.messages(id) ON DELETE CASCADE,

    rating INTEGER CHECK (rating BETWEEN 1 AND 5),  -- 1-5 星評分
    feedback_type TEXT CHECK (feedback_type IN (
        'helpful', 'inaccurate', 'incomplete', 'harmful', 'other'
    )),
    comment TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vet_ai.feedback IS '使用者對 Agent 回答的回饋（用於品質改善）';

-- ====================================
-- 7. 索引
-- ====================================

-- conversations
CREATE INDEX idx_conversations_user_id ON vet_ai.conversations(user_id);
CREATE INDEX idx_conversations_updated_at ON vet_ai.conversations(updated_at DESC);

-- messages
CREATE INDEX idx_messages_conversation_id ON vet_ai.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON vet_ai.messages(created_at);

-- usage_logs
CREATE INDEX idx_usage_logs_user_id ON vet_ai.usage_logs(user_id);
CREATE INDEX idx_usage_logs_created_at ON vet_ai.usage_logs(created_at);

-- protocols
CREATE INDEX idx_protocols_condition ON vet_ai.protocols(condition);
CREATE INDEX idx_protocols_type ON vet_ai.protocols(protocol_type);
CREATE INDEX idx_protocols_species ON vet_ai.protocols USING gin(species);

-- feedback
CREATE INDEX idx_feedback_message_id ON vet_ai.feedback(message_id);

-- ====================================
-- 8. Row Level Security
-- ====================================

-- conversations: 使用者只能存取自己的對話
ALTER TABLE vet_ai.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_conversations" ON vet_ai.conversations
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "service_role_full_access_conversations" ON vet_ai.conversations
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role'
    );

-- messages: 使用者只能存取自己對話中的訊息
ALTER TABLE vet_ai.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_messages" ON vet_ai.messages
    FOR ALL USING (
        conversation_id IN (
            SELECT id FROM vet_ai.conversations WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "service_role_full_access_messages" ON vet_ai.messages
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role'
    );

-- usage_logs: 使用者只能看自己的用量
ALTER TABLE vet_ai.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_usage" ON vet_ai.usage_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_full_access_usage" ON vet_ai.usage_logs
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role'
    );

-- protocols: 所有人可讀
ALTER TABLE vet_ai.protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protocols_read_all" ON vet_ai.protocols
    FOR SELECT USING (true);

CREATE POLICY "service_role_full_access_protocols" ON vet_ai.protocols
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role'
    );

-- feedback: 使用者只能操作自己的回饋
ALTER TABLE vet_ai.feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_feedback" ON vet_ai.feedback
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "service_role_full_access_feedback" ON vet_ai.feedback
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role'
    );

-- ====================================
-- 9. 更新 updated_at 觸發器
-- ====================================
CREATE OR REPLACE FUNCTION vet_ai.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_conversations_updated_at
    BEFORE UPDATE ON vet_ai.conversations
    FOR EACH ROW EXECUTE FUNCTION vet_ai.update_updated_at();

CREATE TRIGGER trigger_protocols_updated_at
    BEFORE UPDATE ON vet_ai.protocols
    FOR EACH ROW EXECUTE FUNCTION vet_ai.update_updated_at();

-- ====================================
-- 10. 跨 schema 搜尋函數（VetEvidence Agent 專用）
-- ====================================

-- Agent 用的文獻搜尋：查 rag.documents
CREATE OR REPLACE FUNCTION vet_ai.search_literature(
    query_embedding VECTOR(1536),
    match_count INT DEFAULT 5,
    match_threshold FLOAT DEFAULT 0.5,
    filter_category TEXT DEFAULT NULL,
    filter_species TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    content TEXT,
    category TEXT,
    species TEXT[],
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vet_ai, rag, public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.title,
        d.content,
        d.category,
        d.species,
        d.metadata,
        1 - (d.embedding <=> query_embedding) AS similarity
    FROM rag.documents d
    WHERE
        1 - (d.embedding <=> query_embedding) >= match_threshold
        AND (filter_category IS NULL OR d.category = filter_category)
        AND (filter_species IS NULL OR filter_species = ANY(d.species))
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION vet_ai.search_literature IS 'Agent 文獻搜尋 — 查詢 rag.documents 向量資料庫';

-- Agent 用的藥物搜尋：查 public.drugs
CREATE OR REPLACE FUNCTION vet_ai.search_drugs(
    drug_name TEXT,
    search_species TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name_en TEXT,
    name_zh TEXT,
    classification TEXT,
    description TEXT,
    mechanism TEXT,
    indications TEXT[],
    contraindications TEXT[],
    side_effects TEXT[],
    interactions TEXT[],
    dosage_dog JSONB,
    dosage_cat JSONB,
    warnings TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vet_ai, public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.name_en,
        d.name_zh,
        d.classification,
        d.description,
        d.mechanism,
        d.indications,
        d.contraindications,
        d.side_effects,
        d.interactions,
        d.dosage_dog,
        d.dosage_cat,
        d.warnings
    FROM public.drugs d
    WHERE
        d.name_en ILIKE '%' || drug_name || '%'
        OR d.name_zh ILIKE '%' || drug_name || '%'
        OR drug_name = ANY(d.trade_names)
    LIMIT 10;
END;
$$;

COMMENT ON FUNCTION vet_ai.search_drugs IS 'Agent 藥物搜尋 — 查詢 public.drugs 藥物資料庫';

-- ====================================
-- 完成
-- ====================================
SELECT '✅ VetEvidence schema (vet_ai) 建立完成' AS status;
SELECT '📊 Schema 區隔: public(DRUGAPI) | rag(知識庫) | vet_ai(Agent)' AS architecture;
