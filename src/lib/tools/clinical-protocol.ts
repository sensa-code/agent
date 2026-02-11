// ============================================================================
// Tool: get_clinical_protocol — SOP 指引查詢
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "@/lib/agent/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Tool Schema for Claude API */
export const clinicalProtocolSchema: ToolDefinition = {
  name: "get_clinical_protocol",
  description:
    "查詢臨床標準作業流程 (SOP) 和治療指引。可根據疾病名稱、治療類型、物種查詢。",
  input_schema: {
    type: "object" as const,
    properties: {
      condition: {
        type: "string",
        description: "疾病或臨床情境名稱（英文），例如 'cardiac arrest', 'diabetic ketoacidosis'",
      },
      protocol_type: {
        type: "string",
        enum: ["diagnosis", "treatment", "emergency", "prevention", "monitoring"],
        description: "Protocol 類型",
      },
      species: {
        type: "string",
        enum: ["canine", "feline", "rabbit", "avian", "reptile", "exotic"],
        description: "物種篩選",
      },
    },
    required: ["condition"],
  },
};

export interface ProtocolResult {
  found: boolean;
  condition: string;
  protocols: Array<{
    title: string;
    type: string;
    species: string[];
    content: string;
    steps: unknown;
    source: string | null;
    source_year: number | null;
  }>;
}

/** 查詢臨床 Protocol */
export async function getClinicalProtocol(input: {
  condition: string;
  protocol_type?: string;
  species?: string;
}): Promise<ProtocolResult> {
  const { condition, protocol_type, species } = input;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: { schema: "vet_ai" },
    });

    let query = supabase
      .from("protocols")
      .select("*")
      .ilike("condition", `%${condition}%`);

    if (protocol_type) {
      query = query.eq("protocol_type", protocol_type);
    }
    if (species) {
      query = query.contains("species", [species]);
    }

    const { data, error } = await query.limit(5);

    if (error) {
      console.error("Protocol query error:", error);
      // Fallback: try via vet_ai schema differently
      return { found: false, condition, protocols: [] };
    }

    if (!data || data.length === 0) {
      return { found: false, condition, protocols: [] };
    }

    return {
      found: true,
      condition,
      protocols: data.map((p: Record<string, unknown>) => ({
        title: (p.title as string) || "",
        type: (p.protocol_type as string) || "",
        species: (p.species as string[]) || [],
        content: (p.content as string) || "",
        steps: p.steps,
        source: (p.source as string) || null,
        source_year: (p.source_year as number) || null,
      })),
    };
  } catch (err) {
    console.error("get_clinical_protocol error:", err);
    return { found: false, condition, protocols: [] };
  }
}
