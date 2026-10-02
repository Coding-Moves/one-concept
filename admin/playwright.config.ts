import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    env: {
      VITE_API_URL: "http://127.0.0.1:8000",
      VITE_SUPABASE_URL: "https://review-auth.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_browser_fixture",
      VITE_ENVIRONMENT: "Staging · test data",
    },
  },
});
