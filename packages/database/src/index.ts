import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

export function getDatabase(): Database {
  if (database) return database;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  client = postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 10 : 1,
    prepare: false,
  });
  database = drizzle(client, { schema });
  return database;
}

export async function closeDatabase() {
  if (client) await client.end();
  client = undefined;
  database = undefined;
}

export type { Database };
export * from "./audit";
export * from "./company-scope";
export * from "./member-repository";
export * from "./schema";
