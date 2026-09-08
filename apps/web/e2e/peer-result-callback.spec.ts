import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("peer result reaches the requesting conversation live and after reload", async ({
  page,
}, testInfo) => {
  await signup(page, `peer-result-${Date.now()}@rakazo.test`, "password12", "Peer Result");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "bots/create", {
    name: "Researcher",
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: false,
  });
  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await composer.fill("message the bot named Researcher saying calculate 23 plus 19");
  await composer.press("Enter");

  type Message = {
    id: string;
    role: string;
    runId?: string;
    blocks: Array<{ kind: string; intent?: string; text?: string }>;
  };
  let summary = "";
  let summaryId = "";
  await expect
    .poll(
      async () => {
        const history = await rpc<{ messages: Message[] }>(page, "threads/messages", {
          botId,
          includePeerRuns: true,
        });
        const result = history.messages.find((message) =>
          message.blocks.some(
            (block) => block.kind === "bot_message_received" && block.intent === "result",
          ),
        );
        if (!result?.runId) return false;
        const response = history.messages.find(
          (message) => message.role === "bot" && message.runId === result.runId,
        );
        summaryId = response?.id ?? "";
        summary = response?.blocks.find((block) => block.kind === "text")?.text ?? "";
        return summary.length > 0;
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  const response = page.getByTestId("transcript").locator(`[data-message-id="${summaryId}"]`);
  // No reload before this assertion: the callback must arrive through live events.
  await expect(response).toBeVisible();
  await expect(response).toContainText(summary.split("\n")[0]);
  await captureScreenshot(page, testInfo, "peer-result-live-desktop");
  await page.reload();
  await expect(response).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(response).toBeVisible();
  await captureScreenshot(page, testInfo, "peer-result-reloaded-mobile");
});
