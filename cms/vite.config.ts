import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FastAPI serves the built CMS at /admin/; in dev, Vite proxies the API to it.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  // Shiki's C++ grammar is about 800 kB and loads only when the preview meets a
  // cpp block. The limit sits just above it so the warning still flags a large
  // app chunk.
  build: { chunkSizeWarningLimit: 850 },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
