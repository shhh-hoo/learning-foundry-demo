import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".vercel/**",
    "dist/**",
    "dist-corpus/**",
    "archive/**",
    "artifacts/**",
    "coverage/**",
    "evals/results/**",
    "playwright-report/**",
    "test-results/**",
    ".agent-eval-results/**",
    ".local-data/**",
    ".runtime-parity-results/**",
  ]),
]);
