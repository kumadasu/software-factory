import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["factory/**/*.test.ts"],
    exclude: ["factory/__fixtures__/**", "runs/**", "node_modules/**"],
    testTimeout: 120_000,
  },
});
