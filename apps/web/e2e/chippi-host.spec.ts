import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`Chippi host navigation and protected identity at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/workforce/personal/qa/app");
    await expect(page.getByRole("combobox", { name: "Message Chippi" })).toBeVisible();
    await page.locator("main").getByRole("button", { name: "Chippi", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveAttribute(
      "readonly",
      "",
    );
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    if (width < 768)
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "Dashboard view" });
    await expect(nav.getByRole("link", { name: "CRM" })).toBeVisible();
    await expect(nav.getByText("Workforce", { exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    if (width < 768) {
      const close = await page.getByRole("button", { name: "Close navigation" }).boundingBox();
      const identity = await page
        .getByRole("combobox", { name: "Switch workspace" })
        .boundingBox();
      expect(identity!.y).toBeGreaterThanOrEqual(close!.y + close!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await testInfo.attach(`chippi-host-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

for (const width of [1280, 390]) {
  test(`named team workspace navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/workforce/team/qa-team/app');
    await expect(page.getByRole('combobox', { name: 'Message Chippi' })).toBeVisible();
    if (width < 768) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const switcher = page.getByRole('combobox', { name: 'Switch workspace' });
    await expect(switcher).toHaveValue('/workforce/team/qa-team/app');
    await expect(switcher.locator('optgroup')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Manage teams' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard view' })).toHaveCount(0);
    await testInfo.attach(`team-workspace-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await switcher.selectOption('/workforce/personal/qa/app');
    await expect(page).toHaveURL(/\/workforce\/personal\/qa\/app$/);
    await expect(page.getByRole('combobox', { name: 'Message Chippi' })).toBeVisible();
  });
}
