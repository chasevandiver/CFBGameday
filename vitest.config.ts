import { defineConfig } from "vitest/config";

// Next's tsconfig uses jsx: "preserve"; vitest needs the transform.
// Component tests opt into jsdom per-file via `// @vitest-environment jsdom`.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "node" },
});
