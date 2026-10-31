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
    // `npm run test:coverage` only. CI posts the summary on each run and
    // uploads lcov to Codacy; the thresholds are a floor so coverage can't
    // fall, to be raised as it grows.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/generated/**", "src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { statements: 30, branches: 20, functions: 33, lines: 30 },
    },
  },
});
