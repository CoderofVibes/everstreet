// The static proof site (web/src/proofSite.tsx): its own entry and output folder.
// Built by scripts/build-proof-site.ts, which also writes the data files it reads.
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "dist-proof",
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "proof.html") },
  },
  preview: { port: 8830, strictPort: true },
});
