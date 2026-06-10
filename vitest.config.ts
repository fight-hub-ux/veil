import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // `server-only` throws outside a server bundle; in the test runner the
      // enforcement code under test is plain Node, so stub it to a no-op.
      "server-only": path.resolve(root, "test/stubs/server-only.ts"),
    },
  },
  test: {
    // One shared Neon dev DB: never run files in parallel, and load .env so the
    // runtime client (lib/db.ts) sees DATABASE_URL.
    fileParallelism: false,
    setupFiles: ["dotenv/config"],
    include: ["lib/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
