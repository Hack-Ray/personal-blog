import { defineConfig } from "@playwright/test";

const PORT = 8124;

// Runs against the static build in out/; `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/personal-blog/`,
  },
  webServer: {
    command: `sh scripts/serve-out.sh ${PORT}`,
    url: `http://127.0.0.1:${PORT}/personal-blog/`,
    reuseExistingServer: !process.env.CI,
    stderr: "ignore",
  },
});
