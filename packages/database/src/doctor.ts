import { config } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

config({ path: "../../.env.local" });
config({ path: "../../.env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder });
const sql = postgres(connectionString, { max: 1, connect_timeout: 5 });
try {
  await sql`select 1`;
  const [table] = await sql<{ name: string | null }[]>`select to_regclass('drizzle.__drizzle_migrations')::text as name`;
  if (!table?.name) throw new Error("migration table is missing; run pnpm db:migrate");
  const applied = await sql<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations`;
  const appliedHashes = new Set(applied.map((migration) => migration.hash));
  const pending = migrations.filter((migration) => !appliedHashes.has(migration.hash));
  if (pending.length) throw new Error(`database has ${pending.length} pending migration${pending.length === 1 ? "" : "s"}; run pnpm db:migrate`);
  console.log(`${migrations.length} migrations applied; schema is current`);
} finally {
  await sql.end();
}
