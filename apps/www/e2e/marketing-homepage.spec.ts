import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: screenshotPath,
  });
  await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
}

test.describe("marketing homepage", () => {
  test("self-host is short CTAs, not an install script", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const selfHost = page.locator("#selfhost");
    await expect(selfHost).toBeVisible();
    await expect(selfHost.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(selfHost.getByRole("button", { name: /Get started/i })).toBeVisible();
    await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);

    await expect(selfHost.locator("pre")).toHaveCount(0);
    await expect(selfHost).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );

    await expect(async () => {
      await selfHost.scrollIntoViewIfNeeded();
    }).toPass({ timeout: 15_000 });
    await captureScreenshot(page, testInfo, "01-marketing-homepage-selfhost");

    await expect(page.locator("html")).toHaveAttribute("data-get-started-ready", "");
    await selfHost.getByRole("button", { name: /Get started/i }).click();
    const dialog = page.locator("[data-get-started-dialog]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toBeVisible();
    await expect(dialog).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );
    await captureScreenshot(page, testInfo, "02-marketing-get-started");
  });

  test("zh homepage matches the simplified self-host CTAs", async ({ page }, testInfo) => {
    await page.goto("/zh/");
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("真正属于你的 AI 队友");
    const selfHost = page.locator("#selfhost");
    await expect(selfHost).toBeVisible();
    await expect(selfHost.getByRole("heading", { level: 2 })).toHaveText("电脑归你所有");
    await expect(selfHost.getByRole("button", { name: "开始使用" })).toBeVisible();
    await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);

    await expect(selfHost.locator("pre")).toHaveCount(0);
    await expect(selfHost).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );

    await expect(async () => {
      await selfHost.scrollIntoViewIfNeeded();
    }).toPass({ timeout: 15_000 });
    await captureScreenshot(page, testInfo, "03-marketing-homepage-zh-selfhost");

    await expect(page.locator("html")).toHaveAttribute("data-get-started-ready", "");
    await selfHost.getByRole("button", { name: "开始使用" }).click();
    const dialog = page.locator("[data-get-started-dialog]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveText("你想如何开始？");
    await expect(dialog).not.toContainText(
      /openssl|docker-compose\.images|POSTGRES_PASSWORD|BETTER_AUTH_SECRET|mkdir rakazo/i,
    );
    await captureScreenshot(page, testInfo, "04-marketing-zh-get-started");
  });

  test("illustrations render inside the feature cards with accessible names", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForLoadState("load");

    // The illustrations hydrate on client:visible, so scroll them into view first.
    const selfHost = page.locator("#selfhost");
    await expect(async () => {
      await selfHost.scrollIntoViewIfNeeded();
    }).toPass({ timeout: 15_000 });

    await expect(selfHost.locator(".feature-card__art")).toHaveCount(3);
    for (const name of [
      /six model providers/i,
      /routines running across a week/i,
      /held for approval/i,
    ]) {
      await expect(selfHost.getByRole("img", { name })).toBeVisible();
    }
    await captureScreenshot(page, testInfo, "05-marketing-feature-illustrations");

    const tools = page.locator("#tools");
    await expect(async () => {
      await tools.scrollIntoViewIfNeeded();
    }).toPass({ timeout: 15_000 });
    await expect(tools.getByRole("heading", { level: 2 })).toHaveText(
      "It works where your work already lives",
    );
    await expect(tools.getByRole("img", { name: /a bot can sign in to/i })).toBeVisible();
    await captureScreenshot(page, testInfo, "06-marketing-tool-wall");

    // The page must not scroll sideways once the fixed-width art is in place.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
