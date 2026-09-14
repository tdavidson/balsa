export type SourceKind =
  | "bank_statement"
  | "brokerage_statement"
  | "quickbooks_transactions"
  | "profit_and_loss"
  | "balance_sheet"
  | "general_ledger"
  | "financial_model"
  | "agreement"
  | "unknown";

export type SourceClassification = {
  kind: SourceKind;
  confidence: "high" | "medium" | "low";
  containsTransactions: boolean;
  containsBalances: boolean;
  containsSummaries: boolean;
  reasons: string[];
};

/** Classify the document shape before asking a model to interpret its values. */
export function classifySource(input: { filename?: string | null; mimeType?: string | null; text?: string | null; sourceRole?: "reference_model" | null | undefined }): SourceClassification {
  const filename = input.filename?.toLowerCase() ?? "";
  const text = input.text?.slice(0, 20_000).toLowerCase() ?? "";
  const combined = `${filename}\n${text}`;
  const reasons: string[] = [];
  const has = (...patterns: RegExp[]) => patterns.some((pattern) => pattern.test(combined));
  const spreadsheet = /\.(csv|xlsx?|ofx|qbo)$/i.test(filename) || /text\/csv|spreadsheet|ofx|quickbooks/i.test(input.mimeType ?? "");
  let kind: SourceKind = "unknown";
  let confidence: SourceClassification["confidence"] = "low";

  if (input.sourceRole === "reference_model") {
    kind = "financial_model";
    reasons.push("explicitly uploaded as a reference model");
  } else if (spreadsheet && has(/financial\s+model|forecast|budget|assumptions|driver|scenario/)) {
    kind = "financial_model";
    reasons.push("spreadsheet contains model or forecast language");
  } else if (has(/profit\s*(?:and|&)\s*loss|income\s+statement|statement\s+of\s+operations/)) {
    kind = "profit_and_loss";
    reasons.push("contains income-statement language");
  } else if (has(/balance\s+sheet|statement\s+of\s+financial\s+position|total\s+assets|total\s+liabilities/)) {
    kind = "balance_sheet";
    reasons.push("contains balance-sheet language");
  } else if (has(/general\s+ledger|trial\s+balance|account\s+number.*debit.*credit/)) {
    kind = "general_ledger";
    reasons.push("contains ledger language");
  } else if (has(/quickbooks|qbo|transaction\s+detail|transaction\s+list/)) {
    kind = "quickbooks_transactions";
    reasons.push("contains transaction-export language");
  } else if (has(/morgan\s+stanley|schwab|fidelity|vanguard|brokerage|portfolio|holdings|securities|investment\s+account/)) {
    kind = "brokerage_statement";
    reasons.push("contains brokerage or holdings language");
  } else if (has(/bank\s+statement|checking|savings|deposit\s+account|account\s+activity|beginning\s+balance.*ending\s+balance/)) {
    kind = "bank_statement";
    reasons.push("contains bank-statement language");
  } else if (has(/agreement|contract|engagement|subscription|retainer|invoice|payment\s+terms/)) {
    kind = "agreement";
    reasons.push("contains agreement or payment-term language");
  } else if (spreadsheet && has(/date|amount|debit|credit|description|memo|payee/)) {
    kind = "quickbooks_transactions";
    reasons.push("spreadsheet has transaction columns");
  }

  const containsTransactions = has(/transaction|activity|date.*amount|debit|credit|withdrawal|deposit|payment/);
  const containsBalances = has(/opening|beginning|ending|closing|balance|total\s+assets|total\s+value/);
  const containsSummaries = has(/summary|consolidated|year[- ]to[- ]date|ytd|total\s+income|total\s+value/);
  if (kind !== "unknown") confidence = reasons.length > 1 || spreadsheet ? "high" : "medium";

  return { kind, confidence, containsTransactions, containsBalances, containsSummaries, reasons };
}
