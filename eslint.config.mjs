import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone-mode spike (#148): plain CommonJS Node scripts run directly
    // by the embedded runtime, outside the Next.js/TS module graph — this
    // config's require()-forbidding TS rules don't apply to them.
    "mobile-standalone/**",
  ]),
]);

export default eslintConfig;
