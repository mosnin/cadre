import { expect, test } from "@playwright/test";
import { createDb } from "../../../packages/db/src/client";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("admin controls are protected, audited, and usable on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.DATABASE_URL, "Requires the isolated E2E database");
  const db = createDb(process.env.DATABASE_URL!);
  const email = `admin-browser-${Date.now()}@example.test`;
  try {
    await signup(page, email, "password12", "Platform operator");
    await completeOnboarding(page);
    await page.goto("/app/admin");
    await expect(page.getByText("This account does not have administrator access.")).toBeVisible();
    expect((await page.request.post("/rpc/admin/overview", { data: { json: {} } })).status()).toBe(
      403,
    );
    // Test fixture setup uses the isolated database; no HTTP bypass exists in the product.
    await db.prisma.user.update({
      where: { email },
      data: { adminRole: "admin", adminVerifiedAt: new Date() },
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByText("Account controls")).toBeVisible();
    await captureScreenshot(page, testInfo, "admin-overview-desktop");
    await page.getByRole("button", { name: "Users", exact: true }).click();
    await page.getByPlaceholder("Search users").fill(email);
    await page.getByRole("button", { name: /Manage/ }).click();
    await expect(page.getByText("Billing", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause all schedules", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Browser verification of schedule controls");
    await captureScreenshot(page, testInfo, "admin-audited-action");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Audit", exact: true }).click();
    await expect(page.getByText("Browser verification of schedule controls")).toBeVisible();
    await captureScreenshot(page, testInfo, "admin-audit-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.getByText("Account controls")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await captureScreenshot(page, testInfo, "admin-overview-mobile");
  } finally {
    await db.prisma.$disconnect();
    await db.pool.end();
  }
});
