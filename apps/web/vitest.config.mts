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
    // Two database-heavy suites can run together without saturating CI runners.
    maxWorkers: 2,
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
});
