import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openNavigation,
  openUserMenu,
  signup,
} from "./helpers";

test("workspace surfaces retain charcoal hierarchy and reachable controls", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signup(page, `sweep-${Date.now()}@cadre.test`, "password12", "Design Review");
  await completeOnboarding(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await openNavigation(page);
    const create = page.getByTestId("create-menu-trigger");
    await expect(create).toHaveText("Create");
    const close = page
      .getByRole("button", { name: "Close navigation", exact: true })
      .filter({ visible: true });
    const [c, x] = await Promise.all([create.boundingBox(), close.boundingBox()]);
    expect(c!.x + c!.width).toBeLessThanOrEqual(x!.x);
    await captureScreenshot(page, info, `navigator-${width}`);
    for (const name of ["Account settings", "Integrations", "Models", "Memory", "Voice"]) {
      await openUserMenu(page);
      await page.getByRole("button", { name, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const panel = await dialog.boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(16);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width - 16);
      if (name === "Integrations") {
        const label = dialog.getByText("Gmail", { exact: true }).first();
        await expect(label).toBeVisible();
        await expect.poll(async () => (await label.boundingBox())?.width ?? 0).toBeGreaterThan(30);
      }
      await captureScreenshot(page, info, `${name.replaceAll(" ", "-")}-${width}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await dialog.getByRole("button", { name: /Close/, exact: false }).last().click();
    }
  }
  expect(errors).toEqual([]);
});
