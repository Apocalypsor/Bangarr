import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  build: { outDir: "dist", target: "es2022" },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3000" } },
});
