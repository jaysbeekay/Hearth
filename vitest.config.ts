import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Points DATABASE_URL / UPLOADS_DIR at a temp dir for every test file;
    // see tests/helpers/testDb.ts for tests that need a migrated database.
    setupFiles: ["tests/helpers/testDbEnv.ts"],
  },
});
