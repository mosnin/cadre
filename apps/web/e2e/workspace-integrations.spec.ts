import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserMenu, signup } from "./helpers";

for (const width of [375, 1440]) {
  test(`workspace connections identify their targets at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signup(
      page,
      `connections-${width}-${Date.now()}@rakazo.test`,
      "password12",
      "Workspace owner",
    );
    await completeOnboarding(page);
    // Provider responses are fixtures. This verifies rendering, not live consent.
    await page.route("**/api/v1/workspace-integrations", (route) =>
      route.fulfill({
        json: {
          available: true,
          providers: [
            { id: "operate", name: "Operate", workspaceNoun: "workspace" },
            { id: "stored", name: "Stored", workspaceNoun: "organization" },
          ],
          connections: [
            {
              provider: "operate",
              externalId: "operate-test",
              externalName: "Studio operations",
              connected: true,
            },
            {
              provider: "stored",
              externalId: "stored-test",
              externalName: "Studio memory",
              connected: true,
            },
          ],
        },
      }),
    );
    await openUserMenu(page);
    await page.getByRole("button", { name: "Account settings", exact: true }).click();
    const settings = page.getByTestId("user-settings");
    await settings.getByTestId("settings-section-connections").click();
    const connections = settings.getByRole("region", { name: "Connections" });
    await connections.scrollIntoViewIfNeeded();
    await expect(connections).toContainText("Studio operations · Connected");
    await expect(connections).toContainText("Studio memory · Connected");
    await expect(connections.getByRole("button", { name: "Disconnect Operate" })).toBeVisible();
    await expect(connections.getByRole("button", { name: "Disconnect Stored" })).toBeVisible();
    await captureScreenshot(page, testInfo, `workspace-connections-${width}`);
  });
}
