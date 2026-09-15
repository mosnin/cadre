import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("failed app script leaves a visible recovery action", async ({ page }, testInfo) => {
  await page.route(/\/(?:assets\/.*\.js|src\/main\.tsx)(?:\?.*)?$/, (route) => route.abort());
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Cadre couldn’t load" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload Cadre" })).toBeVisible();
  await captureScreenshot(page, testInfo, "startup-script-recovery");
  await page.getByRole("button", { name: "Reload Cadre" }).click();
  await expect(page.getByRole("heading", { name: "Cadre couldn’t load" })).toBeVisible();
});

test("a render failure exposes recovery instead of a blank app", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/fixtures/startup-recovery.html");
  await expect(page.getByRole("heading", { name: "Cadre couldn’t open this page" })).toBeVisible();
  await captureScreenshot(page, testInfo, "startup-render-recovery-mobile");
  await expect(page.getByRole("button", { name: "Reload Cadre" })).toBeVisible();
});
