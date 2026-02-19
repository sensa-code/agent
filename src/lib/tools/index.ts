// ============================================================================
// VetEvidence — Tool Router (Unified Knowledge Interface)
// 4 tools: vet_knowledge_search, drug_info, differential_diagnosis, clinical_calculator
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import {
  vetKnowledgeSearchSchema,
  vetKnowledgeSearch,
} from "./vet-knowledge-search";
import { drugInfoSchema, drugInfo } from "./drug-info";
import { clinicalCalculatorSchema, clinicalCalculate } from "./clinical-calculator";
import {
  differentialDiagnosisSchema,
  generateDifferentialDiagnosis,
} from "./differential-diagnosis";

/** All tool definitions for Claude API (4 unified tools) */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  vetKnowledgeSearchSchema,
  drugInfoSchema,
  differentialDiagnosisSchema,
  clinicalCalculatorSchema,
];

/** Execute a tool call by name */
export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "vet_knowledge_search":
      return await vetKnowledgeSearch(input as {
        query: string;
        species?: string;
        include_detail?: boolean;
        include_pubmed?: boolean;
      });

    case "drug_info":
      return await drugInfo(input as {
        drug_name: string;
        species?: string;
        check_interactions?: string[];
      });

    case "differential_diagnosis":
      return await generateDifferentialDiagnosis(input as {
        symptoms: string[];
        species?: string;
        labs?: string[];
        exclude?: string[];
      });

    case "clinical_calculator":
      // Synchronous calculation, no await needed
      return clinicalCalculate(input as {
        calculator_type: string;
        parameters: Record<string, unknown>;
      });

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Re-export for direct access
export { vetKnowledgeSearch } from "./vet-knowledge-search";
export { drugInfo } from "./drug-info";
export { generateDifferentialDiagnosis } from "./differential-diagnosis";
export { clinicalCalculate } from "./clinical-calculator";
