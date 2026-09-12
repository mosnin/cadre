import { expect, test } from "@playwright/test";
import type { CapabilityInstall, Routine } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

for (const width of [1280, 390]) {
  test(`schedules and settings are directly reachable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await signup(page, `controls-${width}-${Date.now()}@rakazo.test`, "password12", "Controls");
    await completeOnboarding(page);
    const computerRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/rpc\/computer\/(boot|screenUrl)/.test(request.url()))
        computerRequests.push(request.url());
    });
    const schedules = page.getByRole("button", { name: "Schedules", exact: true });
    await schedules.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Create Routine" })).toBeVisible();
    if (width < 768) {
      expect(
        await page.evaluate(() => document.elementFromPoint(200, 780)?.closest("aside") !== null),
      ).toBe(true);
      await expect(page.locator("main")).toHaveAttribute("inert", "");
    }
    await captureScreenshot(page, testInfo, `schedules-direct-${width}`);
    await page.getByRole("button", { name: "Create Routine" }).click();
    await page.locator("label:has-text('Name') input").fill("Morning check");
    await page.locator("label:has-text('Instruction') textarea").fill("Summarize today's tasks");
    await page.getByRole("button", { name: "Add trigger" }).click();
    await page.getByRole("menuitem", { name: "On a schedule" }).hover();
    await page.getByRole("menuitem", { name: "Every day", exact: true }).click();
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/rpc/routines/create") && r.ok(),
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await response;
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("button", { name: /Morning check/ })).toBeVisible();
    const rows = await rpc<Routine[]>(page, "routines/list", { botId: activeBotId(page) });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nextRunAt).toBeTruthy();
    expect(computerRequests).toEqual([]);
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    if (width < 768) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await captureScreenshot(page, testInfo, `settings-direct-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("custom plugins survive catalog failure and install once without a refresh", async ({
  page,
}, testInfo) => {
  await signup(page, `custom-controls-${Date.now()}@rakazo.test`, "password12", "Custom Controls");
  await completeOnboarding(page);
  let installs = 0;
  const installed: CapabilityInstall[] = [];
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Catalog unavailable" }),
    }),
  );
  await page.route("**/rpc/capabilities/list", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: installed }) }),
  );
  await page.route("**/rpc/capabilities/install", async (route) => {
    installs += 1;
    const input = route.request().postDataJSON().json;
    expect(input.kind).toBe("mcp");
    expect(input.source).toBe("https://tools.example.test/mcp");
    installed.push({
      id: "custom-test",
      kind: "mcp",
      name: input.name,
      source: input.source,
      version: "1.0.0",
      digest: "sha256:test",
      secretConfigured: false,
      config: {},
      createdAt: new Date().toISOString(),
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: installed[0] }),
    });
  });
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Custom plugins", exact: true }).click();
  await page.getByRole("button", { name: "Add MCP server", exact: true }).click();
  await page.getByLabel("Display name").fill("My tools");
  await page.getByLabel("Source URL").fill("https://tools.example.test/mcp");
  await captureScreenshot(page, testInfo, "custom-plugin-form-desktop");
  await page.getByRole("button", { name: "Verify and add" }).click();
  await expect(page.getByText("My tools", { exact: true })).toBeVisible();
  expect(installs).toBe(1);
  await expect(page.getByText("Could not install connector")).toHaveCount(0);
  await page.getByRole("button", { name: "Close integrations" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Custom plugins", exact: true }).click();
  await expect(page.getByText("My tools", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "custom-plugin-installed-mobile");
});
