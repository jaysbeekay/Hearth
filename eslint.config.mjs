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
    // Serwist writes the compiled service worker here during `next build`.
    // It's generated, bundled third-party code and gitignored, but eslint
    // still picked it up, so `npm run lint` failed with a `no-this-alias`
    // error on any machine that had run a build.
    "public/sw.js",
    "public/sw.js.map",
  ]),
]);

export default eslintConfig;
