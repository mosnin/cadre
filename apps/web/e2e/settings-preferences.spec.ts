import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserMenu, rpc, signup } from "./helpers";

async function openSettings(page: Parameters<typeof openUserMenu>[0]) {
  await openUserMenu(page);
  await page.getByRole("button", { name: "Account settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();
  return settings;
}

test("region and time zone choices persist across reloads", async ({ page }, testInfo) => {
  await signup(page, `preferences-${Date.now()}@cadre.test`, "password12", "Preference Owner");
  await completeOnboarding(page);

  let settings = await openSettings(page);
  await settings.getByTestId("settings-section-region").click();
  const region = settings.getByTestId("region-select");
  await expect(region).toHaveText("Automatic");
  await region.click();
  await settings.getByRole("option", { name: "Germany", exact: true }).click();
  await expect(region).toHaveText("Germany");
  await captureScreenshot(page, testInfo, "settings-region");

  await settings.getByTestId("settings-section-bot").click();
  const automatic = settings.getByTestId("timezone-automatic");
  await expect(automatic).toBeChecked();
  await automatic.click();
  await expect(automatic).not.toBeChecked();
  const zone = settings.getByTestId("timezone-select");
  await zone.click();
  await settings.getByRole("option", { name: "Europe/Berlin", exact: true }).click();
  await expect(zone).toHaveText("Europe/Berlin");
  await captureScreenshot(page, testInfo, "settings-time-zone");
  await expect
    .poll(async () => {
      const me = await rpc<{ region: string | null; timezone: string | null }>(page, "me", {});
      return `${me.region}:${me.timezone}`;
    })
    .toBe("DE:Europe/Berlin");

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  settings = await openSettings(page);
  await settings.getByTestId("settings-section-region").click();
  await expect(settings.getByTestId("region-select")).toHaveText("Germany");
  await settings.getByTestId("settings-section-bot").click();
  await expect(settings.getByTestId("timezone-automatic")).not.toBeChecked();
  await expect(settings.getByTestId("timezone-select")).toHaveText("Europe/Berlin");

  await settings.getByTestId("timezone-automatic").click();
  await expect(settings.getByTestId("timezone-automatic")).toBeChecked();
  await expect(settings.getByTestId("timezone-select")).toHaveCount(0);
  await expect
    .poll(async () => {
      const me = await rpc<{ timezoneAutomatic: boolean }>(page, "me", {});
      return me.timezoneAutomatic;
    })
    .toBe(true);
});
