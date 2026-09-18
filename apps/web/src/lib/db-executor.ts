import type { Database } from "@finance/database";

/** An open transaction: writers whose statements must commit together take this, never the plain database. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The database or an open transaction: loaders that may run inside a forecast job's transaction accept either. */
export type DbExecutor = Database | DbTransaction;
