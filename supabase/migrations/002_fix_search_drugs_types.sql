-- ============================================================================
-- Fix: search_drugs 函數回傳型別與 drugs 表實際型別不匹配
-- drugs 表的 name_en, name_zh, classification 是 varchar(255) 不是 TEXT
-- ============================================================================

DROP FUNCTION IF EXISTS vet_ai.search_drugs(text, text);

CREATE OR REPLACE FUNCTION vet_ai.search_drugs(
    drug_name TEXT,
    search_species TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name_en VARCHAR(255),
    name_zh VARCHAR(255),
    classification VARCHAR(255),
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

COMMENT ON FUNCTION vet_ai.search_drugs IS 'Agent 藥物搜尋 — 查詢 public.drugs（型別已修正）';

SELECT '✅ search_drugs 型別修正完成' AS status;
