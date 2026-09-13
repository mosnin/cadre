import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("reviews all-space Codex consent before issuing access", async ({ page }, testInfo) => {
  await signup(page, `codex-consent-${Date.now()}@rakazo.test`, "password12", "OAuth Fixture");
  await completeOnboarding(page);
  await page.route("**/api/oauth/codex/consent*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { userId: "fixture", name: "OAuth Fixture", execute: false } });
    const body = new URLSearchParams(route.request().postData() ?? "");
    expect(body.get("expected_user_id")).toBe("fixture");
    expect(body.get("decision")).toBe("allow");
    return route.fulfill({ status: 400, json: { error: "fixture_failure" } });
  });
  const params = new URLSearchParams({
    client_id: "cadre-codex-local",
    response_type: "code",
    redirect_uri: "http://127.0.0.1:49152/oauth/callback",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    scope: "cadre:read",
    resource: "https://api.cadre.test/rpc",
    state: "fixture-state",
  });
  await page.goto("/app/oauth/codex?" + params);
  await expect(page.getByRole("heading", { name: "Connect Cadre to Codex" })).toBeVisible();
  await expect(page.getByText("Read work across all spaces you can access.")).toBeVisible();
  await captureScreenshot(page, testInfo, "codex-consent");
  await page.getByRole("button", { name: "Allow access" }).click();
  await expect(page.getByRole("alert")).toContainText("Access is unavailable");
});
