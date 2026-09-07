import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, createNamedBot, signup } from "./helpers";

for (const width of [390, 1365]) {
  test(`call mode is unavailable even with a configured provider at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await signup(
      page,
      `voice-removed-${width}-${Date.now()}@rakazo.test`,
      "password12",
      "Voice Removal",
    );
    await completeOnboarding(page);
    await page.route("**/rpc/voice/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: {
            configured: true,
            ready: true,
            transcribe: true,
            realtime: true,
            provider: "openai",
            voiceId: "coral",
          },
        }),
      }),
    );
    await createNamedBot(page, "Voice check");
    await expect(page.getByPlaceholder("Message Voice check")).toBeVisible();
    await expect(page.getByRole("button", { name: "Call", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("call-view")).toHaveCount(0);
    await captureScreenshot(page, testInfo, `voice-removed-${width}`);
  });
}
