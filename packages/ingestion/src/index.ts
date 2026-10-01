import { PDFParse } from "pdf-parse";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export * from "./source-classification";
export * from "./statement-validation";
export * from "./structured-statements";
export * from "./source-row-adapters";

const knownCurrencies = ["USD", "CAD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD"] as const;
export type KnownCurrency = (typeof knownCurrencies)[number];

/** Returns only currencies explicitly named by the source; a dollar sign alone is ambiguous. */
export function detectSourceCurrencies(text: string): KnownCurrency[] {
  const upper = text.toUpperCase();
  return knownCurrencies.filter((currency) => new RegExp(`\\b${currency}\\b`).test(upper));
}

export type PdfPageText = { page: number; text: string };
export type PdfExtractionQuality = {
  pageCount: number;
  nonEmptyPages: number;
  characters: number;
  averageCharactersPerPage: number;
  status: "good" | "weak" | "empty";
  warnings: string[];
  ocr?: { status: "not_needed" | "succeeded" | "unavailable" | "failed"; command?: string; message?: string };
};

export function assessPdfText(pages: PdfPageText[]): PdfExtractionQuality {
  const nonEmptyPages = pages.filter((page) => page.text.trim().length > 0).length;
  const characters = pages.reduce((total, page) => total + page.text.trim().length, 0);
  const averageCharactersPerPage = pages.length ? Math.round(characters / pages.length) : 0;
  const warnings: string[] = [];
  if (!pages.length || !characters) warnings.push("No selectable text was extracted; this PDF may be scanned or image-only.");
  else if (nonEmptyPages < pages.length) warnings.push(`${pages.length - nonEmptyPages} page${pages.length - nonEmptyPages === 1 ? " has" : "s have"} no selectable text.`);
  if (characters > 0 && averageCharactersPerPage < 40) warnings.push("Very little text was extracted per page; review the original PDF before relying on extracted facts.");
  return { pageCount: pages.length, nonEmptyPages, characters, averageCharactersPerPage, status: !characters ? "empty" : warnings.length ? "weak" : "good", warnings };
}

const execFileAsync = promisify(execFile);

/**
 * Optional OCR fallback. Deployments opt in with BALSA_OCR_COMMAND
 * pointing at an ocrmypdf-compatible executable. The sidecar preserves page
 * breaks, so downstream facts remain traceable to an OCR page.
 */
async function extractOcrPdfDocument(buffer: Uint8Array): Promise<{ pages: PdfPageText[]; detail: NonNullable<PdfExtractionQuality["ocr"]> }> {
  const command = (process.env.BALSA_OCR_COMMAND ?? process.env.NEVERMODEL_OCR_COMMAND)?.trim();
  if (!command) return { pages: [], detail: { status: "unavailable", message: "OCR is not configured on this deployment." } };
  const directory = await mkdtemp(join(tmpdir(), "balsa-ocr-"));
  const input = join(directory, "source.pdf");
  const output = join(directory, "ocr.pdf");
  const sidecar = join(directory, "ocr.txt");
  try {
    await writeFile(input, buffer);
    await execFileAsync(command, ["--sidecar", sidecar, input, output], { timeout: 120_000, maxBuffer: 2_000_000 });
    const text = await readFile(sidecar, "utf8");
    const pages = text.split(/\f/).map((page, index) => ({ page: index + 1, text: page.trim() })).filter((page) => page.text.length > 0);
    if (!pages.length) return { pages, detail: { status: "failed", command, message: "OCR completed without a readable text sidecar." } };
    return { pages, detail: { status: "succeeded", command } };
  } catch (error) {
    return { pages: [], detail: { status: "failed", command, message: error instanceof Error ? error.message.slice(0, 300) : "OCR command failed." } };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function extractPdfDocument(buffer: Uint8Array): Promise<{ text: string; pages: PdfPageText[]; quality: PdfExtractionQuality }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = result.pages.map((page) => ({ page: page.num, text: page.text.trim() }));
    let selectedPages = pages;
    let quality = assessPdfText(selectedPages);
    if (quality.status !== "good") {
      const ocr = await extractOcrPdfDocument(buffer);
      const ocrQuality = assessPdfText(ocr.pages);
      if (ocr.detail.status === "succeeded" && ocrQuality.characters > quality.characters) {
        selectedPages = ocr.pages;
        quality = { ...ocrQuality, ocr: ocr.detail, warnings: [...ocrQuality.warnings, "Text was recovered by OCR; review OCR-sensitive amounts and identifiers."] };
      } else {
        quality = { ...quality, ocr: ocr.detail, warnings: [...quality.warnings, ocr.detail.status === "unavailable" ? "OCR fallback is unavailable; configure BALSA_OCR_COMMAND or upload a searchable copy." : `OCR fallback did not improve this source${ocr.detail.message ? `: ${ocr.detail.message}` : "."}`] };
      }
    } else quality = { ...quality, ocr: { status: "not_needed" } };
    const text = selectedPages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join("\n\n");
    return { text, pages: selectedPages, quality };
  } finally { await parser.destroy(); }
}

export async function extractPdfText(buffer: Uint8Array): Promise<string> {
  return (await extractPdfDocument(buffer)).text;
}

export type TransactionRow = { date: string; postedDate?: string; description: string; amount: number; direction: "receipt" | "spend"; sourceLocation?: string };

export function transactionExternalKey(transaction: Pick<TransactionRow, "date" | "postedDate" | "description" | "amount" | "direction">): string {
  return createHash("sha256").update(`${transaction.postedDate ?? transaction.date}|${transaction.description}|${transaction.amount.toFixed(2)}|${transaction.direction}`).digest("hex");
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

/** Parse the common formats emitted by bank, brokerage, and GL exports without
 * silently turning an unrecognized amount into a posting. */
function amount(value: string) {
  const normalized = value.trim()
    .replace(/[$,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/(CR|CREDIT)$/i, "")
    .replace(/(DR|DEBIT)$/i, "-");
  if (!normalized || /^[-–—]$/.test(normalized)) return 0;
  return Number(normalized);
}

function fullDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Expand statement-style M/D and M/D/YY dates using the dated source filename or reporting period. */
export function expandFinancialFactDates<T extends { label: string; value: string }>(facts: T[], sourceDate?: string | null): T[] {
  const sourceYear = Number(sourceDate?.match(/\b(20\d{2})(?:-\d{2})?(?:-\d{2})?\b/)?.[1]);
  const expand = (text: string) => text
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g, (match, month, day, year) => {
      const numericYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
      return fullDate(numericYear, Number(month), Number(day)) ?? match;
    })
    .replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (match, month, day) => sourceYear ? fullDate(sourceYear, Number(month), Number(day)) ?? match : match);
  return facts.map((fact) => ({ ...fact, label: expand(fact.label), value: expand(fact.value) }));
}

export function normalizeTransactions(rows: string[][], fallbackMonth: string): TransactionRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const find = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  // Keep this deliberately header-based. A source is not allowed to become an
  // accounting transaction merely because a number appears in an arbitrary column.
  const date = find(/^(transaction |posted |posting |effective |process )?date$|^date$/);
  const value = find(/^(amount|transaction amount|net amount|total amount|value|transaction value)$/);
  const debit = find(/^(debit|debits|withdrawal|withdrawals|outflow|outflows|money out|paid out)$/);
  const credit = find(/^(credit|credits|deposit|deposits|inflow|inflows|money in|paid in)$/);
  const descriptionColumns = headers.flatMap((header, index) => /^(description|memo|note|notes|payee|merchant|name|details|transaction description)$/.test(header) ? [index] : []);
  return rows.slice(1).flatMap((cells, index) => {
    const direct = value >= 0 ? amount(cells[value] ?? "") : 0;
    const d = debit >= 0 ? Math.abs(amount(cells[debit] ?? "")) : 0;
    const c = credit >= 0 ? Math.abs(amount(cells[credit] ?? "")) : 0;
    const signed = direct || c - d;
    if (!Number.isFinite(signed) || signed === 0) return [];
    const rawDate = cells[date] ?? "";
    const parsed = /^\d{5}(?:\.\d+)?$/.test(rawDate) ? new Date(Date.UTC(1899, 11, 30) + Number(rawDate) * 86400000) : new Date(rawDate);
    const postedDate = Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
    const month = postedDate?.slice(0, 7) ?? fallbackMonth;
    const description = [...new Set(descriptionColumns.map((index) => cells[index]?.trim()).filter(Boolean))].join(" · ") || "Imported transaction";
    return [{ date: month, ...(postedDate ? { postedDate } : {}), description, amount: Math.abs(signed), direction: signed < 0 ? "spend" : "receipt", sourceLocation: `row:${index + 2}` }];
  });
}

export function parseOfx(text: string): TransactionRow[] {
  return [...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>))/gi)].flatMap((match, index) => {
    const block = match[1] ?? ""; const tag = (name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, "i"))?.[1]?.trim() ?? "";
    const signed = amount(tag("TRNAMT")); if (!Number.isFinite(signed) || signed === 0) return [];
    const rawDate = tag("DTPOSTED").slice(0, 8);
    const postedDate = rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const description = [...new Set([tag("NAME"), tag("MEMO")].filter(Boolean))].join(" · ") || "Imported transaction";
    return [{ date: postedDate.slice(0, 7), postedDate, description, amount: Math.abs(signed), direction: signed < 0 ? "spend" as const : "receipt" as const, sourceLocation: `transaction:${index + 1}` }];
  });
}
