import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./packages/testkit/src/pin-test-env.ts"],
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "infra/sandboxes/supervisor/src/**/*.test.ts",
      "infra/updater/src/**/*.test.ts",
      "apps/mobile/lib/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      "apps/worker/src/**/*.test.ts",
      "apps/www/src/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
