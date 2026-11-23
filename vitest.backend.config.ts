import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      src: fileURLToPath(new URL("./src", import.meta.url)),
      actions: fileURLToPath(new URL("./actions", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/__tests__/setup/testSetup.ts"],
    testTimeout: 30000,
    clearMocks: false,
    unstubEnvs: true,
    retry: 0,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/**/__mocks__/**"],
      reportsDirectory: "reports/jest-coverage",
      reporter: ["text", "lcov"],
    },
  },
});
