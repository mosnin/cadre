import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

for (const width of [320, 390, 768, 1440]) {
  test(`linear workspace setup and connected work surfaces at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : width === 768 ? 600 : 900 });
    await page.addInitScript(() => localStorage.setItem("cadre.uiAppearance", "system"));
    await page.emulateMedia({ colorScheme: "light" });
    await signup(
      page,
      `surfaces-${width}-${Date.now()}@cadre.test`,
      "password12",
      "Workspace Owner",
    );
    await completeOnboarding(page);
    await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
    await expect(page.getByTestId("workspace-name")).toContainText("Personal");
    await expect(page.getByRole("button", { name: "Company context", exact: true })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await captureScreenshot(page, testInfo, "conversation-focused");
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await expect(page.getByTestId("bots-sidebar")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search conversations" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await captureScreenshot(page, testInfo, "workspace-navigator");
    await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
    await captureScreenshot(page, testInfo, "workspace-choices");
    await page.getByRole("button", { name: "New workspace", exact: true }).click();
    await page.getByLabel("Workspace name", { exact: true }).fill("Client studio");
    await page.reload();
    await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue("Client studio");
    await captureScreenshot(page, testInfo, "setup-workspace");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect your company" })).toBeVisible();
    await captureScreenshot(page, testInfo, "setup-company");
    await page.getByRole("button", { name: "Close setup", exact: true }).click();
    await expect(page.getByTestId("bots-sidebar")).toBeVisible();
    await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await expect(page.getByRole("group", { name: "Message composer" })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue setup", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect your company" })).toBeVisible();
    await page.getByRole("button", { name: "Continue without a company" }).click();
    if (await page.getByRole("heading", { name: "Connect a model" }).isVisible()) {
      await page.getByRole("button", { name: "Skip for now" }).click();
    }
    await page.getByLabel("Name", { exact: true }).fill("Studio assistant");
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Studio assistant");
    await captureScreenshot(page, testInfo, "setup-agent");
    await page.getByRole("button", { name: "Create agent", exact: true }).click();
    await expect(page.getByTestId("bot-settings-trigger")).toContainText("Studio assistant");
    await expect(page.getByTestId("workspace-name")).toContainText("Client studio");
    await captureScreenshot(page, testInfo, "first-task");
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await captureScreenshot(page, testInfo, "first-task-dark");
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await captureScreenshot(page, testInfo, "workspace-navigator-dark");
    await page.getByTestId("create-menu-trigger").click();
    await page.getByTestId("create-new-bot").click();
    await expect(page.getByTestId("bots-sidebar")).not.toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Research partner");
    await page.getByLabel("Purpose", { exact: true }).fill("Research questions for the studio");
    await captureScreenshot(page, testInfo, "create-another-agent");
    await page.getByRole("button", { name: "Create agent", exact: true }).click();
    await expect(page.getByTestId("bot-settings-trigger")).toContainText("Research partner");
  });
}
