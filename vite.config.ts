import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(rootDir, "ui"),
  build: {
    outDir: path.resolve(rootDir, "dist/ui"),
    emptyOutDir: true,
    target: "esnext",
  },
  base: "/status-ui/",
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
