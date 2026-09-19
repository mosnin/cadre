import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  openNavigation,
  openNewGroup,
  signup,
} from "./helpers";

test("clicking an agent from a group chat opens that agent", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `sidebar-switch-${stamp}@cadre.test`, "password12", "Test User");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  const chiefId = activeBotId(page);
  const writerId = await createNamedBot(page, "Sidebar Writer");

  await openNewGroup(page);
  await page.locator("label:has-text('Name') input").fill("Sidebar group");
  const panel = page.getByTestId("side-panel");
  await panel.getByRole("button", { name: "Chief" }).click();
  await panel.getByRole("button", { name: "Sidebar Writer" }).click();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await page.waitForURL(/\/app\/g\/[^/]+$/);
  await expect(page.getByRole("combobox", { name: "Message Sidebar group" })).toBeVisible();

  await openNavigation(page);
  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar.getByRole("button", { name: /^Sidebar group/ })).toBeVisible();
  await expect(sidebar.locator(".cadre-orb").first()).toHaveAttribute("data-orb-live", "true");
  await captureScreenshot(page, testInfo, "sidebar-orbs-group");

  await sidebar.locator(`[data-roster-bot-id="${chiefId}"]`).click();
  await page.waitForURL(new RegExp(`/app/${chiefId}$`));
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toBeVisible();

  await openNavigation(page);
  await sidebar.locator(`[data-roster-bot-id="${writerId}"]`).click();
  await page.waitForURL(new RegExp(`/app/${writerId}$`));
  await expect(page.getByRole("combobox", { name: "Message Sidebar Writer" })).toBeVisible();

  await openNavigation(page);
  await sidebar.getByRole("button", { name: /^Sidebar group/ }).click();
  await page.waitForURL(/\/app\/g\/[^/]+$/);
  await expect(page.getByRole("combobox", { name: "Message Sidebar group" })).toBeVisible();
});
