import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  createBotFromPicker,
  openNavigation,
  signup,
} from "./helpers";

test("creating an agent returns to work and navigation restores keyboard focus", async ({
  page,
}, testInfo) => {
  await signup(page, `new-bot-ux-${Date.now()}@cadre.test`, "password12", "New Bot UX");
  await completeOnboarding(page);
  await createBotFromPicker(page);
  await expect(page.getByPlaceholder("Message New Bot")).toBeVisible();
  await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
  await captureScreenshot(page, testInfo, "create-chat-focused");
  await openNavigation(page);
  await expect(page.getByRole("textbox", { name: "Search conversations" })).toBeFocused();
  await page.keyboard.press("Escape");
  const show = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(show).toBeFocused();
  await show.press("Enter");
  await expect(page.getByTestId("bots-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await page.reload();
  await expect(show).toBeVisible();
  await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
  await captureScreenshot(page, testInfo, "navigation-recedes");
});

test("later bot waits before showing the focus card; sending cancels it", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `focus-delay-${stamp}@cadre.test`, "password12", "Focus Delay");
  await completeOnboarding(page);
  // First bot from onboarding shows the focus card immediately.
  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();

  await page.clock.install();
  await createBotFromPicker(page);
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByPlaceholder("Message New Bot")).toBeVisible();
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);

  await page.clock.fastForward(9_000);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  await page.clock.fastForward(1_500);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();

  await createBotFromPicker(page);
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("I'll set this up myself");
  await page.keyboard.press("Enter");
  await page.clock.fastForward(12_000);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
});
