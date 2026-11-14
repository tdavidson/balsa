import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: "../../.env.local" });
config({ path: "../../.env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

// Migrations emit routine PostgreSQL notices (identifier truncation, "does not
// exist, skipping"). They are expected, so keep setup output readable and let
// real errors surface on their own.
const client = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
try {
  await migrate(drizzle(client), { migrationsFolder });
} finally {
  await client.end();
}
console.log("Database migrations complete");
