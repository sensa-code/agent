// ============================================================================
// VetEvidence — MCP Server（Model Context Protocol）
// ============================================================================
// Usage: node --loader ts-node/esm src/lib/mcp/server.ts
// Transport: stdio

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { searchVetLiterature } from "@/lib/tools/search-vet-literature";
import { drugLookup } from "@/lib/tools/drug-lookup";
import { clinicalCalculate } from "@/lib/tools/clinical-calculator";

const server = new Server(
  {
    name: "vet-evidence-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/** List all available tools */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_vet_literature",
        description: "搜尋獸醫文獻資料庫（183K+ documents, 164 textbooks）。Query 必須使用英文。",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "搜尋關鍵字（英文）",
            },
            species: {
              type: "string",
              description: "物種篩選（canine/feline）",
            },
            category: {
              type: "string",
              description: "分類篩選",
            },
            max_results: {
              type: "number",
              description: "最大回傳數量（預設 5）",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "drug_lookup",
        description: "查詢獸醫藥物資訊，包括劑量、禁忌症、交互作用等。",
        inputSchema: {
          type: "object" as const,
          properties: {
            drug_name: {
              type: "string",
              description: "藥物名稱（英文或中文）",
            },
            species: {
              type: "string",
              description: "物種（canine/feline）",
            },
            info_type: {
              type: "string",
              description: "資訊類型（full/dosage/contraindications/interactions/side_effects）",
            },
          },
          required: ["drug_name"],
        },
      },
      {
        name: "clinical_calculator",
        description: "獸醫臨床計算器：藥物劑量、輸液速率、RER、中毒評估、IRIS 分期。",
        inputSchema: {
          type: "object" as const,
          properties: {
            calculator_type: {
              type: "string",
              enum: ["drug_dose", "fluid_rate", "rer", "toxicity", "iris_staging"],
              description: "計算器類型",
            },
            parameters: {
              type: "object",
              description: "計算參數",
            },
          },
          required: ["calculator_type", "parameters"],
        },
      },
    ],
  };
});

/** Handle tool calls */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "search_vet_literature":
        result = await searchVetLiterature(args as {
          query: string;
          species?: string;
          category?: string;
          max_results?: number;
        });
        break;

      case "drug_lookup":
        result = await drugLookup(args as {
          drug_name: string;
          species?: string;
          info_type?: string;
        });
        break;

      case "clinical_calculator":
        result = clinicalCalculate(args as {
          calculator_type: string;
          parameters: Record<string, unknown>;
        });
        break;

      default:
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
        };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

/** Start the server */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VetEvidence MCP Server running on stdio");
}

main().catch(console.error);
