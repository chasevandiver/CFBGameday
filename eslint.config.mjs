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
    // Deno, not Next: `Deno.serve`, `npm:` specifiers, and ESPN's untyped
    // scoreboard JSON. It ships to Supabase, never through this build, and it
    // has been failing `npm run lint` — and therefore CI — since it landed
    // with NFL-8 (#66).
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
