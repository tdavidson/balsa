import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Bound worker startup and database pressure while retaining parallel suites.
    maxWorkers: 4,
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
});
