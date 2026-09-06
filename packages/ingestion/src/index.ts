import { PDFParse } from "pdf-parse";
import { createHash } from "node:crypto";

export async function extractPdfText(buffer: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
}

export type TransactionRow = { date: string; description: string; amount: number; direction: "receipt" | "spend" };

export function transactionExternalKey(transaction: Pick<TransactionRow, "date" | "description" | "amount" | "direction">): string {
  return createHash("sha256").update(`${transaction.date}|${transaction.description}|${transaction.amount.toFixed(2)}|${transaction.direction}`).digest("hex");
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function amount(value: string) { return Number(value.replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1")); }

export function normalizeTransactions(rows: string[][], fallbackMonth: string): TransactionRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((h) => h.toLowerCase());
  const date = headers.findIndex((h) => /date/.test(h));
  const value = headers.findIndex((h) => /amount|total|value/.test(h));
  const debit = headers.findIndex((h) => /debit|withdrawal|outflow/.test(h));
  const credit = headers.findIndex((h) => /credit|deposit|inflow/.test(h));
  const description = headers.findIndex((h) => /description|memo|payee|name/.test(h));
  return rows.slice(1).flatMap((cells) => {
    const direct = value >= 0 ? amount(cells[value] ?? "") : 0;
    const d = debit >= 0 ? Math.abs(amount(cells[debit] ?? "")) : 0;
    const c = credit >= 0 ? Math.abs(amount(cells[credit] ?? "")) : 0;
    const signed = direct || c - d;
    if (!Number.isFinite(signed) || signed === 0) return [];
    const rawDate = cells[date] ?? "";
    const parsed = /^\d{5}(?:\.\d+)?$/.test(rawDate) ? new Date(Date.UTC(1899, 11, 30) + Number(rawDate) * 86400000) : new Date(rawDate);
    const month = Number.isNaN(parsed.getTime()) ? fallbackMonth : parsed.toISOString().slice(0, 7);
    return [{ date: month, description: cells[description] || "Imported transaction", amount: Math.abs(signed), direction: signed < 0 ? "spend" : "receipt" }];
  });
}

export function parseOfx(text: string): TransactionRow[] {
  return [...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>))/gi)].flatMap((match) => {
    const block = match[1] ?? ""; const tag = (name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, "i"))?.[1]?.trim() ?? "";
    const signed = amount(tag("TRNAMT")); if (!Number.isFinite(signed) || signed === 0) return [];
    return [{ date: tag("DTPOSTED").slice(0, 6).replace(/^(\d{4})(\d{2})$/, "$1-$2"), description: tag("NAME") || tag("MEMO") || "Imported transaction", amount: Math.abs(signed), direction: signed < 0 ? "spend" as const : "receipt" as const }];
  });
}
