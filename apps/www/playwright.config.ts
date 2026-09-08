import { defineConfig, devices } from "@playwright/test";
import { resolveWwwPort } from "./www-port.mjs";

const port = resolveWwwPort();
const baseURL = process.env.PLAYWRIGHT_WWW_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../web/test-results/www-marketing",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ...(process.env.CI ? ([["github"]] as const) : []),
    ["list"] as const,
    ["html", { open: "never", outputFolder: "../../playwright-report-www" }] as const,
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Exercise the deployed static output. Dev dependency optimization can reload
    // the page during a click and discard an otherwise successfully opened dialog.
    command: "pnpm build && node e2e/preview.mjs",
    url: baseURL,
    reuseExistingServer: Boolean(process.env.PLAYWRIGHT_WWW_BASE_URL) && !process.env.CI,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
