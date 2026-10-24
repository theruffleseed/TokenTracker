import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://tokentracker:tokentracker@localhost:5433/tokentracker_test?schema=public",
      APP_URL: BASE_URL,
      AUTH_SECRET: "e2e-auth-secret-value-that-is-long-enough-000000",
      CREDENTIAL_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      SESSION_COOKIE_SECURE: "false",
      ALLOW_REGISTRATION: "true",
      INLINE_REFRESH: "false",
      ENABLE_EXPERIMENTAL_ADAPTERS: "true",
      RATE_LIMIT_DISABLED: "true",
    },
  },
});
