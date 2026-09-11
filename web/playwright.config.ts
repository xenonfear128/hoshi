import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  workers: 1,
  retries: 0,
  use: {
    locale: "zh-CN",
    baseURL: process.env.E2E_ORIGIN || "http://localhost:8080",
    viewport: { width: 1512, height: 1000 },
    headless: true,
    launchOptions: {
      args: process.env.E2E_TLS_SPKI
        ? ["--ignore-certificate-errors-spki-list=" + process.env.E2E_TLS_SPKI]
        : [],
    },
    ignoreHTTPSErrors: process.env.E2E_INSECURE_TLS === "true",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
