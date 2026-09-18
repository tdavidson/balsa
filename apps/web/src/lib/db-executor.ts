import type { Database } from "@finance/database";

/** The database or an open transaction: loaders that may run inside a forecast job's transaction accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
