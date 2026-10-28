import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FastAPI serves the built CMS at /admin/; in dev, Vite proxies the API to it.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  // Mermaid's ELK layout is about 1.5 MB and loads only when a diagram asks for
  // it, after Mermaid itself loads for a draft with a diagram. The limit sits
  // just above it so the warning still flags a large app chunk.
  build: { chunkSizeWarningLimit: 1500 },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
