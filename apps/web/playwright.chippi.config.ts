import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "chippi-host.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3041",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report-chippi", open: "never" }]],
  webServer: {
    command: "node ../../node_modules/tsx/dist/cli.mjs ../../scripts/chippi-preview.mts",
    url: "http://127.0.0.1:3041/workforce/personal/qa/app",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
