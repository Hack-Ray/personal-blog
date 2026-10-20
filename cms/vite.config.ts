import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FastAPI serves the built CMS at /admin/; in dev, Vite proxies the API to it.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
