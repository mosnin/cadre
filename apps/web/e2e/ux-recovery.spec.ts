import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("password12");
  await page.getByRole("button", { name: "Continue with email" }).click();
}

async function signOut(page: import("@playwright/test").Page) {
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Cadre" })).toBeVisible();
}

test("email sign-in returns to the requested conversation", async ({ page }) => {
  const email = `return-path-${Date.now()}@example.test`;
  await signup(page, email, "password12", "Return path");
  await completeOnboarding(page);
  const bot = await rpc<{ id: string }>(page, "bots/create", {
    name: "Review assistant",
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: true,
  });
  await signOut(page);
  await page.goto(`/app/${bot.id}`);
  await signIn(page, email);
  await expect(page).toHaveURL(new RegExp(`/app/${bot.id}$`));
  await expect(page.getByRole("combobox", { name: "Message Review assistant" })).toBeVisible();
});

test("admin sign-in preserves the private claim fragment", async ({ page }, testInfo) => {
  const email = `admin-return-${Date.now()}@example.test`;
  await signup(page, email, "password12", "Admin return");
  await completeOnboarding(page);
  await signOut(page);
  await page.goto("/app/admin#claim=fixture-claim-code");
  await expect(page.getByRole("heading", { name: "Sign in to Cadre" })).toBeVisible();
  expect(new URL(page.url()).search).not.toContain("fixture-claim-code");
  await page.route("**/rpc/admin/status", (route) =>
    route.fulfill({
      json: { json: { allowed: false, canClaim: true, needsClaimCode: true, fresh: true } },
    }),
  );
  await signIn(page, email);
  await expect(page.getByLabel("One-time claim code")).toHaveValue("fixture-claim-code");
  await expect(page).toHaveURL(/\/app\/admin$/);
  await captureScreenshot(page, testInfo, "admin-return-preserves-claim");
});

test("unknown routes offer a working way back on a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/missing-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureScreenshot(page, testInfo, "missing-page-mobile");
  await page.getByRole("link", { name: "Back to Cadre" }).click();
  await expect(page.getByText(/A workforce on demand/)).toBeVisible();
});

test("admin reauthentication keeps its claim code and recovers from sign-out failure", async ({
  page,
}) => {
  const email = `admin-reauth-${Date.now()}@example.test`;
  await signup(page, email, "password12", "Admin reauthentication");
  await completeOnboarding(page);
  let fresh = false;
  await page.route("**/rpc/admin/status", (route) =>
    route.fulfill({
      json: { json: { allowed: false, canClaim: true, needsClaimCode: true, fresh } },
    }),
  );
  await page.goto("/app/admin#claim=fixture-reauth-code");
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Sign-out temporarily unavailable" },
    }),
  );
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("alert")).toContainText("Sign-out temporarily unavailable");
  await expect(page.getByRole("button", { name: "Sign in again" })).toBeEnabled();
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Cadre" })).toBeVisible();
  expect(new URL(page.url()).search).not.toContain("fixture-reauth-code");
  fresh = true;
  await signIn(page, email);
  await expect(page.getByLabel("One-time claim code")).toHaveValue("fixture-reauth-code");
  await expect(page).toHaveURL(/\/app\/admin$/);
});
