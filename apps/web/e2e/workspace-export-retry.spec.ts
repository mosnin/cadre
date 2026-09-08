import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("workspace export explicitly starts the computer and keeps export failures retryable", async ({
  page,
}, testInfo) => {
  await signup(
    page,
    `workspace-export-${Date.now()}@rakazo.test`,
    "password12",
    "Workspace Export",
  );
  await completeOnboarding(page);
  const gear = page.getByRole("button", { name: "Show settings" });
  if (!(await gear.isVisible().catch(() => false))) await page.getByTitle("Agent computer").click();
  await gear.click();
  const settings = page.getByTestId("bot-settings");
  let exportAttempts = 0;
  let boots = 0;
  let pendingStartup = false;
  let startupPolls = 0;
  await page.route("**/rpc/computer/boot", async (route) => {
    boots++;
    const response = await route.fetch();
    const body = await response.json();
    pendingStartup = true;
    await route.fulfill({ response, json: { ...body, json: { ...body.json, state: "booting" } } });
  });
  await page.route("**/rpc/computer/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (pendingStartup && ++startupPolls < 2) {
      await route.fulfill({
        response,
        json: { ...body, json: { ...body.json, state: "booting" } },
      });
    } else {
      pendingStartup = false;
      await route.fulfill({ response });
    }
  });
  await page.route("**/rpc/export/bot", async (route) => {
    expect(pendingStartup).toBe(false);
    exportAttempts++;
    if (exportAttempts <= 2) {
      const requiresStart = exportAttempts === 1;
      await route.fulfill({
        status: requiresStart ? 409 : 500,
        contentType: "application/json",
        body: JSON.stringify({
          json: {
            defined: false,
            code: requiresStart ? "CONFLICT" : "INTERNAL_SERVER_ERROR",
            status: requiresStart ? 409 : 500,
            message: requiresStart
              ? "Start computer to access current files"
              : "Workspace exceeds checkpoint limit",
          },
        }),
      });
    } else {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: { version: 1, files: [{ path: "current.txt", content: "Fresh volume contents" }] },
        }),
      });
    }
  });
  await settings.getByRole("button", { name: "Export", exact: true }).click();
  await expect(settings.getByRole("alert")).toHaveText("Start computer to access current files");
  expect(boots).toBe(0);
  const start = settings.getByRole("button", { name: "Start computer and retry export" });
  await expect(start).toBeVisible();
  await captureScreenshot(page, testInfo, "workspace-export-start-required");
  await page.setViewportSize({ width: 390, height: 844 });
  await start.click();
  await expect(settings.getByRole("alert")).toHaveText("Workspace exceeds checkpoint limit");
  expect(boots).toBe(1);
  expect(startupPolls).toBeGreaterThanOrEqual(2);
  await expect(start).toHaveCount(0);
  await captureScreenshot(page, testInfo, "workspace-export-error-after-start-mobile");
  const downloaded = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/chief-export\.json/i);
  await expect(settings.getByRole("alert")).toHaveCount(0);
  expect(boots).toBe(1);
  expect(exportAttempts).toBe(3);
});
