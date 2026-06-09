import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: { port: 5173, open: false },
  build: { outDir: "dist", target: "es2022" },
});
