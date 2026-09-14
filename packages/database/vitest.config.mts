import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/drizzle/**", "**/dist/**"],
    // Every suite here talks to one Postgres; run files in sequence so the
    // shared RLS test role and per-run fixtures do not race.
    fileParallelism: false,
  },
});
