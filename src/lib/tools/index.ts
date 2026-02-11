// ============================================================================
// VetEvidence — Tool Router
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import {
  searchVetLiteratureSchema,
  searchVetLiterature,
} from "./search-vet-literature";
import { drugLookupSchema, drugLookup } from "./drug-lookup";

/** All tool definitions for Claude API */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  searchVetLiteratureSchema,
  drugLookupSchema,
];

/** Execute a tool call by name */
export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "search_vet_literature":
      return await searchVetLiterature(input as {
        query: string;
        species?: string;
        category?: string;
        max_results?: number;
      });

    case "drug_lookup":
      return await drugLookup(input as {
        drug_name: string;
        species?: string;
        info_type?: string;
      });

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Re-export for direct access
export { searchVetLiterature } from "./search-vet-literature";
export { drugLookup } from "./drug-lookup";
