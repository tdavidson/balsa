import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { getDatabase } from "./index";

config({ path: "../../.env.local" });
config({ path: "../../.env" });

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
await migrate(getDatabase(), { migrationsFolder });
console.log("Database migrations complete");
