import type { CompanyState } from "@nevermodel/company-state";

export type AgentContext = {
  companyId: string;
  state: CompanyState;
  knowledge?: Record<string, string>;
  policies?: { name: string; rule: string }[];
  /** Deterministic engine output, loaded by the server for this company. */
  forecast?: { month: string; receipts: number; spending: number; net: number; endingCash: number; actualReceipts?: number; actualSpending?: number; variance?: number; trace?: unknown[] }[];
};
export type AgentTool = { name: string; description: string; inputSchema: Record<string, unknown>; execute: (context: AgentContext, input: Record<string, unknown>) => Promise<unknown> };

export const controlledToolNames = ["read_company_state", "read_evidence", "read_knowledge", "read_policies", "propose_decision", "query_forecast", "trace_value", "get_obligations", "get_allocations"] as const;

export function createReadStateTool(): AgentTool {
  return { name: "read_company_state", description: "Read the authorized company state.", inputSchema: { type: "object", additionalProperties: false }, execute: async (context) => context.state };
}

export function createReadEvidenceTool(): AgentTool {
  return { name: "read_evidence", description: "Read evidence already loaded for the authorized company.", inputSchema: { type: "object", properties: { status: { type: "string" } }, additionalProperties: false }, execute: async (context, input) => context.state.facts.filter((fact) => !input.status || fact.status === input.status) };
}

export function createReadKnowledgeTool(): AgentTool {
  return { name: "read_knowledge", description: "Read authorized Markdown knowledge documents.", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } }, additionalProperties: false }, execute: async (context, input) => ({ slug: input.slug, content: context.knowledge?.[String(input.slug)] ?? null }) };
}

export function createReadPoliciesTool(): AgentTool {
  return { name: "read_policies", description: "Read active policies for the authorized company.", inputSchema: { type: "object", additionalProperties: false }, execute: async (context) => context.policies ?? [] };
}

export function createProposeDecisionTool(): AgentTool {
  return { name: "propose_decision", description: "Create a proposed CFO decision for review; it does not mutate persisted state.", inputSchema: { type: "object", required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } }, additionalProperties: false }, execute: async (context, input) => ({ companyId: context.companyId, type: "decision", status: "proposed", question: input.question, answer: input.answer }) };
}

export function createQueryForecastTool(): AgentTool {
  return {
    name: "query_forecast",
    description: "Query the deterministic cash forecast for the authorized company.",
    inputSchema: { type: "object", properties: { month: { type: "string", pattern: "^20\\d{2}-\\d{2}$" } }, additionalProperties: false },
    execute: async (context, input) => {
      const rows = context.forecast ?? [];
      const month = typeof input.month === "string" ? rows.find((row) => row.month === input.month) : undefined;
      return month ? { companyId: context.companyId, months: [month] } : { companyId: context.companyId, months: rows };
    },
  };
}

export function createTraceValueTool(): AgentTool {
  return { name: "trace_value", description: "Explain the authorized source lineage for a forecast month.", inputSchema: { type: "object", required: ["month"], properties: { month: { type: "string", pattern: "^20\\d{2}-\\d{2}$" } }, additionalProperties: false }, execute: async (context, input) => { const month = context.forecast?.find((row) => row.month === input.month); return { companyId: context.companyId, month: input.month, value: month ?? null, trace: month?.trace ?? [] }; } };
}

export function createGetObligationsTool(): AgentTool {
  return { name: "get_obligations", description: "Read confirmed obligations and their authorized settlement state.", inputSchema: { type: "object", additionalProperties: false }, execute: async (context) => ({ companyId: context.companyId, obligations: context.state.obligations }) };
}

export function createGetAllocationsTool(): AgentTool {
  return { name: "get_allocations", description: "Read authorized allocation records for fund reimbursement analysis.", inputSchema: { type: "object", additionalProperties: false }, execute: async (context) => ({ companyId: context.companyId, allocations: context.state.allocations }) };
}

export function createControlledTools(): AgentTool[] { return [createReadStateTool(), createReadEvidenceTool(), createReadKnowledgeTool(), createReadPoliciesTool(), createProposeDecisionTool(), createQueryForecastTool(), createTraceValueTool(), createGetObligationsTool(), createGetAllocationsTool()]; }
