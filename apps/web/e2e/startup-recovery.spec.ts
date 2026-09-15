import { expect, test } from "@playwright/test";

test("failed app script leaves a visible recovery action", async ({ page }) => {
  await page.route(/\/(?:assets\/.*\.js|src\/main\.tsx)(?:\?.*)?$/, (route) => route.abort());
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Cadre couldn’t load" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload Cadre" })).toBeVisible();
  await page.getByRole("button", { name: "Reload Cadre" }).click();
  await expect(page.getByRole("heading", { name: "Cadre couldn’t load" })).toBeVisible();
});

test("a render failure exposes recovery instead of a blank app", async ({ page }) => {
  await page.goto("/e2e/fixtures/startup-recovery.html");
  await expect(page.getByRole("heading", { name: "Cadre couldn’t open this page" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload Cadre" })).toBeVisible();
});
