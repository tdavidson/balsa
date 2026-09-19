import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@finance/database/schema";

/** An isolated test executor whose pool size is explicit; callers must close it in `finally`. */
export function createTestDatabase(url: string, options: { max: number }) {
  const client = postgres(url, { max: options.max, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  return Object.assign(db, { end: () => client.end() });
}

export type TestDatabase = ReturnType<typeof createTestDatabase>;
