import { config } from "dotenv";
import { and, eq, ilike } from "drizzle-orm";
import { getDatabase, reviewItems } from "@finance/database";

config({ path: "../../.env.local" });
config({ path: "../../.env" });

const apply = process.argv.includes("--apply");
const db = getDatabase();
async function main() {
  const rows = await db.select().from(reviewItems).where(and(eq(reviewItems.status, "open"), ilike(reviewItems.question, "%klingenstein%")));
  console.log(`${apply ? "Resolving" : "Would resolve"} ${rows.length} open Klingenstein review item${rows.length === 1 ? "" : "s"}.`);
  for (const row of rows) {
    console.log(`- ${row.id}: ${row.question}`);
    if (apply) {
      await db.update(reviewItems).set({ status: "resolved", answer: "Resolved from the reparsed uploaded bank-statement evidence, including transaction dates, amounts, and identifying notes.", updatedAt: new Date() }).where(and(eq(reviewItems.id, row.id), eq(reviewItems.status, "open")));
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
