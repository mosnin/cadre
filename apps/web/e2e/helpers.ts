import { expect, type Page, type TestInfo } from "@playwright/test";

export function isRealSandboxProvider(provider = process.env.SANDBOX_PROVIDER) {
  return provider === "e2b" || provider === "daytona" || provider === "box";
}

export function realSandboxTimeout(real: number, emulated: number) {
  if (process.env.SANDBOX_PROVIDER === "box") return Math.max(real, 300_000);
  return isRealSandboxProvider() ? real : emulated;
}

export function activeBotId(page: Page) {
  const id = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  if (!id || id === "app") throw new Error(`missing bot id in ${page.url()}`);
  return id;
}

export async function rpc<T>(page: Page, procedure: string, body?: unknown): Promise<T> {
  const spaceId = await page.evaluate(() => localStorage.getItem("cadre:space-id"));
  const response = await page.request.post(`/rpc/${procedure}`, {
    data: { json: body },
    headers: spaceId ? { "x-cadre-space-id": spaceId } : {},
  });
  const parsed = (await response.json()) as { json?: T; error?: { message?: string } };
  if (!response.ok() || parsed.error) {
    throw new Error(`${procedure} ${response.status()}: ${parsed.error?.message ?? "failed"}`);
  }
  return parsed.json as T;
}

export async function completeOnboarding(page: Page, testInfo?: TestInfo) {
  await page.waitForURL(/\/(onboarding|app)/, { timeout: 20_000 });
  const heading = page.getByRole("heading", {
    name: /Connect your company|Connect a model|Create your first agent/,
  });
  const chief = page.getByTestId("bot-settings-trigger").filter({ hasText: "Chief" });
  await heading.or(chief).waitFor({ timeout: 20_000 });
  if ((await chief.isVisible().catch(() => false)) && page.url().includes("/app")) return;
  if (
    await page
      .getByRole("heading", { name: "Connect your company" })
      .isVisible()
      .catch(() => false)
  ) {
    if (testInfo) await captureScreenshot(page, testInfo, "02-connect-company");
    await page.getByRole("button", { name: "Continue without a company" }).click();
  }
  if (
    await page
      .getByRole("heading", { name: "Connect a model" })
      .isVisible()
      .catch(() => false)
  ) {
    if (testInfo) await captureScreenshot(page, testInfo, "02-connect-model");
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page
      .getByRole("heading", { name: "Create your first agent" })
      .or(chief)
      .waitFor({ timeout: 20_000 });
  }
  if (
    await page
      .getByRole("heading", { name: "Create your first agent" })
      .isVisible()
      .catch(() => false)
  ) {
    if (testInfo) await captureScreenshot(page, testInfo, "03-create-first-bot");
    await page.locator("label:has-text('Name') input").fill("Chief");
    const created = page.waitForResponse(
      (response) => response.url().includes("/rpc/bots/create") && response.ok(),
    );
    await page.getByRole("button", { name: "Create agent", exact: true }).click();
    await created;
    await page.waitForURL(/\/app\//, { timeout: 20_000 });
  }
  await page.waitForURL(/\/app/);
  await expect(chief).toBeVisible();
  if (testInfo) await captureScreenshot(page, testInfo, "06-onboarding-complete");
}

export async function signup(
  page: Page,
  email: string,
  password: string,
  name: string,
  testInfo?: TestInfo,
) {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your Cadre" })).toBeVisible();
  if (testInfo) await captureScreenshot(page, testInfo, "01-sign-up");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  for (const panel of await page
    .locator('[data-slot="popover-content"][data-open][data-settled]')
    .all()) {
    await expect(panel).toHaveAttribute("data-settled", "true");
  }
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: screenshotPath,
  });
  await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
}

export async function openNavigation(page: Page) {
  const sidebar = page.getByTestId("bots-sidebar");
  if (await sidebar.isVisible()) return;
  // The rail is part of the desktop layout and opens with the app, so it is
  // usually already here. When it is not, either it was closed on desktop —
  // which is a stored preference that survives a reload — or this is the
  // phone drawer. Both are reopened by a control named "Open navigation";
  // only one of the two is rendered at a time, so take whichever is visible
  // rather than assuming.
  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  await open.first().waitFor({ state: "visible", timeout: 15_000 });
  await open.first().click();
  await sidebar.waitFor({ state: "visible", timeout: 15_000 });
}

export async function openUserMenu(page: Page) {
  await openNavigation(page);
  await page.getByTestId("user-menu-trigger").click();
}

export async function openNewBot(page: Page) {
  await openNavigation(page);
  await page.getByTestId("create-menu-trigger").click();
  await page.getByTestId("create-new-bot").click();
}

export async function openNewGroup(page: Page) {
  await openNavigation(page);
  await page.getByTestId("create-menu-trigger").click();
  await page.getByTestId("create-new-group").click();
}

export async function openNewSpace(page: Page) {
  await openNavigation(page);
  await page.getByTestId("create-menu-trigger").click();
  await page.getByTestId("create-new-space").click();
}

/** Create an agent through the visible name-and-purpose form. */
export async function createBotFromPicker(page: Page) {
  await openNewBot(page);
  await page.getByLabel("Name", { exact: true }).fill("New Bot");
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByTestId("side-panel")).toHaveAttribute("data-panel", "closed");
}

/** Create a named bot via RPC for test setup (skips the + picker). */
export async function createNamedBot(
  page: Page,
  name: string,
  options: { computerMode?: "team" | "dedicated" } = {},
) {
  const bot = await rpc<{ id: string; name: string }>(page, "bots/create", {
    name,
    title: "",
    description: "",
    notifyOnFinish: true,
    computerMode: options.computerMode ?? "team",
  });
  await page.goto(`/app/${bot.id}`);
  await expect(page.getByPlaceholder(`Message ${name}`)).toBeVisible();
  return bot.id;
}
