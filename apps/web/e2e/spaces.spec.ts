import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("workspace menu creates and switches isolated conversation contexts", async ({
  page,
}, testInfo) => {
  await signup(page, `spaces-${Date.now()}@rakazo.test`, "password12", "Space Owner");
  await completeOnboarding(page);
  const sidebar = page.locator("aside").first();
  const switcher = page.getByRole("button", { name: "Switch workspace", exact: true });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await expect(
    page
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: "Connect Company OS", exact: true }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-menu");
  await page.getByRole("button", { name: "New workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New space" });
  await dialog.getByLabel("Name").fill("Customer support");
  await captureScreenshot(page, testInfo, "new-workspace");
  await dialog.getByRole("button", { name: "Create space", exact: true }).click();
  await page.waitForURL(/\/onboarding/);
  await completeOnboarding(page);
  const supportId = await page.evaluate(() => localStorage.getItem("rakazo:space-id"));
  await expect(switcher).toContainText("Customer support");
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(1);
  await switcher.click();
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await expect(switcher).toContainText("Personal");
  expect(await page.evaluate(() => localStorage.getItem("rakazo:space-id"))).not.toBe(supportId);
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(1);
  await switcher.click();
  await page
    .locator('[data-slot="popover-content"]')
    .getByRole("button", { name: "Connect Company OS", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Connect a company" })).toBeVisible();
  await expect(
    page.getByText(/Create a company or choose an existing business in Company OS/),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "company-workspace-onboarding");
});

test("account settings exposes company connection and onboarding", async ({ page }, testInfo) => {
  await signup(page, `company-settings-${Date.now()}@rakazo.test`, "password12", "Company Owner");
  await completeOnboarding(page);
  // This verifies the configured UI; protocol and tenant boundaries use the real database suite.
  await page.route("**/api/v1/company-workspaces", (route) =>
    route.fulfill({ json: { available: true, connections: [] } }),
  );
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Account settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings.getByRole("heading", { name: "Company OS", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "company-account-settings");
  await settings.getByRole("button", { name: "Connect Company OS", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a company", exact: true });
  await dialog.getByLabel("Workspace", { exact: true }).selectOption("");
  await dialog.getByLabel("Workspace name").fill("New business");
  await expect(
    dialog.getByRole("button", { name: "Continue to Company OS", exact: true }),
  ).toBeEnabled();
  await captureScreenshot(page, testInfo, "company-connection-configured");
});

test("agent workspace creation still requires user approval", async ({ page }) => {
  await signup(page, `space-approval-${Date.now()}@rakazo.test`, "password12", "Space Owner");
  await completeOnboarding(page);
  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await composer.fill("Create a space named Customer support");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Create space", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Always allow this tool" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create space", exact: true }).click();
  await expect(page.getByText("Created", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Customer support", exact: true })).toBeVisible();
});

for (const phone of [false, true]) {
  test(`production workspace controls and company identity ${phone ? "phone" : "desktop"}`, async ({
    page,
  }, testInfo) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v1/company-workspaces", (route) =>
      route.fulfill({ json: { available: true, connections: [] } }),
    );
    await signup(
      page,
      `company-identity-${phone}-${Date.now()}@rakazo.test`,
      "password12",
      "Company Owner",
    );
    await completeOnboarding(page);
    if (phone) {
      const back = page.getByRole("button", { name: "Open navigation", exact: true });
      if (await back.isVisible()) await back.click();
    }
    const status = page.getByTestId("workspace-company-status");
    await expect(status).toContainText("Company OS");
    await expect(status).toContainText("No company connected");
    await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
    const menu = page.locator('[data-slot="popover-content"]');
    await expect(menu.getByRole("button", { name: "New workspace", exact: true })).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "Connect Company OS", exact: true }),
    ).toBeVisible();
    await expect(menu.getByRole("button", { name: "Create company", exact: true })).toBeVisible();
    await captureScreenshot(page, testInfo, "company-workspace-actions");
    await menu.getByRole("button", { name: "Create company", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Create a company", exact: true })).toBeVisible();
    await expect(page.getByLabel("Workspace name")).toBeVisible();
    await captureScreenshot(page, testInfo, "create-company-onboarding");
    await page.keyboard.press("Escape");
    const me = await page.request.post("/rpc/me", { data: { json: {} } });
    const { json: actor } = await me.json();
    await page.route("**/api/v1/company-workspaces", (route) =>
      route.fulfill({
        json: {
          available: true,
          connections: [
            {
              spaceId: actor.spaceId,
              companyName: "Example Company",
              companySlug: "example",
              connected: true,
            },
          ],
        },
      }),
    );
    await page.reload();
    await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
    if (phone) {
      const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
      if (await navigation.isVisible()) await navigation.click();
    }
    await expect(status).toBeVisible();
    await expect(status).toContainText("Example Company");
    await expect(status).toContainText("Connected");
    await captureScreenshot(page, testInfo, "connected-company-identity");
  });
}
