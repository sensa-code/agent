// ============================================================================
// VetEvidence — Tool Router
// ============================================================================

import type { ToolDefinition } from "@/lib/agent/types";
import {
  searchVetLiteratureSchema,
  searchVetLiterature,
} from "./search-vet-literature";
import { drugLookupSchema, drugLookup } from "./drug-lookup";
import { clinicalCalculatorSchema, clinicalCalculate } from "./clinical-calculator";
import { clinicalProtocolSchema, getClinicalProtocol } from "./clinical-protocol";
import { differentialDiagnosisSchema, generateDifferentialDiagnosis } from "./differential-diagnosis";

/** All tool definitions for Claude API */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  searchVetLiteratureSchema,
  drugLookupSchema,
  clinicalCalculatorSchema,
  clinicalProtocolSchema,
  differentialDiagnosisSchema,
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

    case "clinical_calculator":
      // Synchronous calculation, no await needed
      return clinicalCalculate(input as {
        calculator_type: string;
        parameters: Record<string, unknown>;
      });

    case "get_clinical_protocol":
      return await getClinicalProtocol(input as {
        condition: string;
        protocol_type?: string;
        species?: string;
      });

    case "differential_diagnosis":
      // Synchronous, no await needed
      return generateDifferentialDiagnosis(input as {
        symptoms: string[];
        species: string;
        age_years?: number;
        breed?: string;
        sex?: string;
        additional_info?: string;
      });

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Re-export for direct access
export { searchVetLiterature } from "./search-vet-literature";
export { drugLookup } from "./drug-lookup";
export { clinicalCalculate } from "./clinical-calculator";
export { getClinicalProtocol } from "./clinical-protocol";
export { generateDifferentialDiagnosis } from "./differential-diagnosis";
