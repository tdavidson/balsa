import { and, eq, like } from "drizzle-orm";
import { cashEvents, evidence, getDatabase } from "@finance/database";
import { classifyCashActivity, financialEventKey, inferFinancialDirection, isDetailedFinancialEvent, parseFinancialAmount } from "../apps/web/src/lib/financial-events";

function dateFromFact(value: string) {
  const raw = value.match(/\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/20\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i)?.[0];
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function monthFromFact(value: string, fallback: string) {
  return dateFromFact(value)?.slice(0, 7) ?? value.match(/\b(20\d{2}-\d{2})\b/)?.[1] ?? fallback;
}

async function main() {
  const db = getDatabase();
  const advisoryStatements = await db.select({ id: evidence.id, sourceName: evidence.sourceName, extractedJson: evidence.extractedJson })
    .from(evidence)
    .where(and(eq(evidence.status, "approved"), like(evidence.sourceName, "ClientStatements-keyAcc-2023-03-17-14.56.00.%")));

  const targets = advisoryStatements.filter((source) => /dt-2026-(07|08)-31/i.test(source.sourceName));
  if (targets.length !== 2) throw new Error(`Expected exactly two standalone Advisory July/August statements; found ${targets.length}`);

  for (const source of targets) {
    const extraction = source.extractedJson ? JSON.parse(source.extractedJson) as { facts?: { label: string; value: string }[] } : { facts: [] };
    const seen = new Set<string>();
    const rebuilt = (extraction.facts ?? []).flatMap((fact) => {
      const description = `${fact.label}: ${fact.value}`;
      if (!isDetailedFinancialEvent(description)) return [];
      const parsedAmount = parseFinancialAmount(fact.value);
      if (parsedAmount === undefined) return [];
      const direction = inferFinancialDirection(parsedAmount < 0 ? "spend" : "receipt", description);
      const category = direction === "receipt" && /klingenstein/i.test(description)
        ? "revenue" as const
        : classifyCashActivity(description, direction);
      const event = {
        companyId: "__company__",
        evidenceId: source.id,
        month: monthFromFact(fact.value, /dt-(20\d{2}-\d{2})/i.exec(source.sourceName)?.[1] ?? ""),
        transactionDate: dateFromFact(fact.value),
        description,
        amount: String(Math.abs(parsedAmount)),
        direction,
        category,
        isActual: "Y" as const,
      };
      const key = financialEventKey(event);
      if (seen.has(key)) return [];
      seen.add(key);
      return [event];
    });
    if (!rebuilt.length) throw new Error(`No individual transactions found in ${source.sourceName}`);
    const [existing] = await db.select({ companyId: evidence.companyId }).from(evidence).where(eq(evidence.id, source.id));
    if (!existing) throw new Error(`Evidence not found: ${source.id}`);
    await db.delete(cashEvents).where(and(eq(cashEvents.evidenceId, source.id), eq(cashEvents.companyId, existing.companyId)));
    await db.insert(cashEvents).values(rebuilt.map((event) => ({ ...event, companyId: existing.companyId })));
    console.log(`${source.sourceName}: rebuilt ${rebuilt.length} individual transactions`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
