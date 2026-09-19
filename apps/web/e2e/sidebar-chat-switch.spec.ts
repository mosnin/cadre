import { expect, test } from "@playwright/test";
import {
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
  const writerId = await createNamedBot(page, "Sidebar Writer");

  await openNewGroup(page);
  await page.locator("label:has-text('Name') input").fill("Sidebar group");
  const panel = page.getByTestId("side-panel");
  await panel.getByRole("button", { name: "Chief" }).click();
  await panel.getByRole("button", { name: "Sidebar Writer" }).click();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await page.waitForURL(/\/app\/g\/[^/]+$/);

  await openNavigation(page);
  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByRole("button", { name: /^Sidebar group/ })).toBeVisible();
  const railOrb = sidebar.locator(".cadre-orb").first();
  await expect(railOrb).toHaveAttribute("data-orb-live", "true");
  await captureScreenshot(page, testInfo, "sidebar-orbs-group");

  await sidebar.getByRole("button", { name: /^Chief/ }).click();
  await page.waitForURL(/\/app\/(?!g\/)[^/]+$/);
  await expect(page).not.toHaveURL(/\/app\/g\//);
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toBeVisible();

  await openNavigation(page);
  await sidebar.getByRole("button", { name: /^Sidebar Writer/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${writerId}$`));
  await expect(page.getByRole("combobox", { name: "Message Sidebar Writer" })).toBeVisible();

  await openNavigation(page);
  await sidebar.getByRole("button", { name: /^Sidebar group/ }).click();
  await expect(page).toHaveURL(/\/app\/g\/[^/]+$/);
  await expect(page.getByRole("combobox", { name: "Message Sidebar group" })).toBeVisible();
});
