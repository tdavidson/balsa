import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { closeDatabase, getDatabase } from "./index";

config({ path: "../../.env.local" });
config({ path: "../../.env" });

const companyId = process.argv.find((value) => value.startsWith("--company-id="))?.slice("--company-id=".length);
const confirmed = process.argv.includes("--confirm=DELETE_COMPANY_DATA");
if (!companyId || !confirmed) throw new Error("Usage: tsx src/reset-company.ts --company-id=<uuid> --confirm=DELETE_COMPANY_DATA");

const db = getDatabase();
const removed = await db.transaction(async (tx) => {
  const count = async (name: string, table: string) => {
    const result = await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE "company_id" = ${companyId}`);
    return { name, count: result.count };
  };
  // Delete derived and dependent state first. The company, members, and users
  // are intentionally absent from this list.
  return [
    await count("reconciliation entries", "reconciliation_entries"),
    await count("allocations", "allocations"),
    await count("cash events", "cash_events"),
    await count("economic items", "economic_items"),
    await count("approval events", "approval_events"),
    await count("fact records", "fact_records"),
    await count("review items", "review_items"),
    await count("observations", "observations"),
    await count("ingestion runs", "ingestion_runs"),
    await count("evidence", "evidence"),
    await count("policies", "policies"),
    await count("decisions", "decisions"),
    await count("knowledge documents", "knowledge_documents"),
    await count("reporting periods", "reporting_periods"),
    await count("scenarios", "scenarios"),
    await count("assumptions", "assumptions"),
    await count("relationships", "relationships"),
    await count("entities", "entities"),
    await count("LLM messages", "llm_messages"),
    await count("LLM runs", "llm_runs"),
    await count("sources", "sources"),
  ];
});
console.log(JSON.stringify({ companyId, removed }));
await closeDatabase();
