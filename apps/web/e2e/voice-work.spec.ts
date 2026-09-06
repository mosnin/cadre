import { expect, test } from "@playwright/test";
import type { ThreadSnapshot } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("a spoken request executes computer tools and reads the result", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    class Recognition {
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { voiceRecognition: Recognition }).voiceRecognition = this;
      }
      stop() {}
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await signup(page, `voice-work-${Date.now()}@rakazo.test`, "password12", "Voice Work");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "voice/connect", { provider: "scripted", apiKey: "fake-scripted-voice-key" });
  // Browser recognition is deterministic here; recorder/STT selection has separate unit coverage.
  await page.route("**/rpc/voice/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          configured: true,
          ready: true,
          transcribe: false,
          provider: "scripted",
          voiceId: "scripted",
        },
      }),
    }),
  );
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Call", exact: true }).click();
  const call = page.getByTestId("call-view");
  await expect(call.locator('[data-slot="fluid-orb"]')).toBeVisible();
  await captureScreenshot(page, testInfo, "mobile-fluid-voice-orb");
  const send = page.waitForRequest((request) => request.url().endsWith("/rpc/threads/send"));
  const spoken: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/voice/speak")) spoken.push(request.postDataJSON().text);
  });
  await page.evaluate(() => {
    const rec = (window as unknown as { voiceRecognition: { onresult: (event: unknown) => void } })
      .voiceRecognition;
    rec.onresult({
      resultIndex: 0,
      results: [[{ transcript: "Use your screen and type voiceproof" }]],
    });
  });
  expect((await send).postDataJSON().json.text).toBe("Use your screen and type voiceproof");
  await expect
    .poll(
      async () => {
        const snapshot = await rpc<ThreadSnapshot>(page, "threads/get", { botId });
        const message = snapshot.messages.at(-1);
        return (
          !snapshot.run &&
          message?.role === "bot" &&
          message.blocks.some(
            (block) => block.kind === "text" && block.text.includes("using my screen now"),
          )
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const completed = await rpc<ThreadSnapshot>(page, "threads/get", { botId });
  const steps = completed.messages
    .at(-1)
    ?.blocks.flatMap((block) =>
      block.kind === "steps" ? block.steps.map((step) => step.label) : [],
    );
  expect(steps).toEqual(expect.arrayContaining(["Computer observe", "Computer act"]));
  await expect
    .poll(() => spoken.some((text) => text.includes("using my screen now")), { timeout: 30_000 })
    .toBe(true);
  await expect(call.getByRole("status")).toHaveText("Listening…", { timeout: 30_000 });
  await page.getByRole("button", { name: "Hang up", exact: true }).click();
  await expect(call).toHaveCount(0);
  await expect(
    page.getByTestId("transcript").getByText("using my screen now.", { exact: true }),
  ).toBeVisible();
});
