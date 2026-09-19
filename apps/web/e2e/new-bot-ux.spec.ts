import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  createBotFromPicker,
  openNavigation,
  signup,
} from "./helpers";

test("creating an agent returns to work and the rail keeps its state", async ({
  page,
}, testInfo) => {
  await signup(page, `new-bot-ux-${Date.now()}@rakazo.test`, "password12", "New Bot UX");
  await completeOnboarding(page);
  await createBotFromPicker(page);
  await expect(page.getByPlaceholder("Message New Bot")).toBeVisible();
  // The rail is part of the desktop layout, so creating an agent leaves it
  // where it was rather than pushing it off screen.
  await expect(page.getByTestId("bots-sidebar")).toBeVisible();
  await captureScreenshot(page, testInfo, "create-chat-focused");
  await openNavigation(page);
  await expect(page.getByRole("textbox", { name: "Search conversations" })).toBeVisible();
  const show = page.getByRole("button", { name: "Open navigation", exact: true });
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
  // Closing hands focus back to the control that reopens it.
  await expect(show).toBeFocused();
  await show.press("Enter");
  await expect(page.getByTestId("bots-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await page.reload();
  // And the choice survives the reload, because it is a stored preference now.
  await expect(show).toBeVisible();
  await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
  await captureScreenshot(page, testInfo, "navigation-recedes");
});

test("later bot waits before showing the focus card; sending cancels it", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `focus-delay-${stamp}@rakazo.test`, "password12", "Focus Delay");
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
