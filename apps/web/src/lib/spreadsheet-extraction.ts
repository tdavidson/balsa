import "server-only";
import ExcelJS from "exceljs";
import { MAX_EXTRACTED_TEXT_CHARACTERS } from "@/lib/ingestion-guardrails";

const MAX_WORKSHEETS = 25;
const MAX_ROWS = 50_000;
const MAX_CELLS = 500_000;

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value && value.result !== undefined && value.result !== null) return String(value.result);
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item && typeof item === "object" && "text" in item ? String(item.text ?? "") : "").join("");
  return "";
}

/** Convert untrusted workbooks with bounded structural and text complexity. */
export async function extractSpreadsheetText(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (workbook.worksheets.length > MAX_WORKSHEETS) throw new Error(`Spreadsheet has too many worksheets (maximum ${MAX_WORKSHEETS}).`);

  let rowCount = 0;
  let cellCount = 0;
  let characterCount = 0;
  const sheets: string[] = [];
  for (const worksheet of workbook.worksheets) {
    const rows: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      rowCount += 1;
      if (rowCount > MAX_ROWS) throw new Error(`Spreadsheet has too many populated rows (maximum ${MAX_ROWS.toLocaleString()}).`);
      const values = (row.values as unknown[]).slice(1).map((value) => {
        cellCount += 1;
        if (cellCount > MAX_CELLS) throw new Error(`Spreadsheet has too many populated cells (maximum ${MAX_CELLS.toLocaleString()}).`);
        return csvCell(cellText(value));
      });
      const line = values.join(",");
      characterCount += line.length + 1;
      if (characterCount > MAX_EXTRACTED_TEXT_CHARACTERS) throw new Error(`Spreadsheet text is too large to process safely (maximum ${MAX_EXTRACTED_TEXT_CHARACTERS.toLocaleString()} characters).`);
      rows.push(line);
    });
    if (rows.length) sheets.push(`--- ${worksheet.name} ---\n${rows.join("\n")}`);
  }
  return sheets.join("\n\n");
}
