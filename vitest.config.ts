import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dedicated Vitest config, deliberately separate from vite.config.ts:
// vite.config.ts is the production bundler config (root: "ui", base: "/status-ui/",
// custom outDir) and is touched by the review-fix commits — keeping the test config
// out of it avoids perturbing the build and stops Vitest from inheriting root: "ui"
// (which would make the include globs below relative to ui/). Jest still owns src/**;
// this runner owns ui/** only, so the two never collide.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["ui/**/*.test.{ts,tsx}"],
    setupFiles: ["./ui/vitest.setup.ts"],
    css: false,
  },
});
