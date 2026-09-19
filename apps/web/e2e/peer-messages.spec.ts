import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("shows peer chips in transcript and opens view-only peer chat", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `peer-msg-${stamp}@cadre.test`, "password12", "Peer Msg");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const chiefId = activeBotId(page);
  await rpc(page, "bots/create", {
    name: "Researcher",
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: true,
  });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toBeVisible();

  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await composer.fill(
    "message the bot named Researcher saying Please confirm receipt of the launch brief.",
  );
  await composer.press("Enter");
  await expect(page.getByText("I’ll send that to Researcher.").first()).toBeVisible({
    timeout: 60_000,
  });

  await expect
    .poll(
      async () => {
        const history = await rpc<{
          messages: Array<{ blocks: Array<{ kind: string; text?: string }> }>;
        }>(page, "threads/messages", { botId: chiefId, includePeerRuns: true });
        const peerTexts = history.messages.flatMap((message) =>
          message.blocks
            .filter(
              (block) => block.kind === "bot_message_sent" || block.kind === "bot_message_received",
            )
            .map((block) => block.text ?? ""),
        );
        return peerTexts.some((text) =>
          text.includes("Please confirm receipt of the launch brief."),
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  // Scope to the composer: the rail is on screen beside it now, and a roster
  // row whose preview reads "I'll send that" matches a bare name of "Send".
  await expect(page.getByTestId("composer-bar").getByRole("button", { name: "Send" })).toBeVisible({
    timeout: 60_000,
  });

  const transcript = page.getByTestId("transcript");
  await expect(
    transcript.getByText("Researcher received your message.", { exact: true }),
  ).toBeVisible();
  await expect(transcript).not.toContainText("A message just arrived");
  await expect(transcript).not.toContainText("[bot]");
  await expect(transcript).not.toContainText("done. i handled:");

  const chip = transcript
    .getByTestId("peer-receipt-chip")
    .filter({ hasText: "Researcher" })
    .first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip.getByText(/Messaged|Message from/)).toBeVisible();
  await expect(chip).toHaveAccessibleName(/Messaged Researcher|Message from Researcher/);
  await expect(chip.locator(".cadre-bot-avatar")).toBeVisible();
  await expect(chip).not.toContainText("{peer}");
  // User bubble still contains the phrase; peer body must not appear outside the chip.
  await expect(chip).not.toContainText("Please confirm receipt of the launch brief.");
  await expect(transcript.getByText("Please confirm receipt of the launch brief.")).toHaveCount(1);
  const assertChipLeftAligned = async () => {
    const transcriptBox = await transcript.locator("[aria-live=off]").boundingBox();
    const chipBox = await chip.boundingBox();
    expect(transcriptBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    // Receipts align to the readable conversation column at every viewport.
    expect(chipBox!.x - transcriptBox!.x).toBeLessThanOrEqual(32);
    // The label has intrinsic width; phone typography can exceed half the column.
    // It must stay compact, left aligned, and clear of the opposite gutter.
    expect(chipBox!.x).toBeGreaterThanOrEqual(transcriptBox!.x);
    expect(chipBox!.x + chipBox!.width).toBeLessThan(transcriptBox!.x + transcriptBox!.width - 32);
  };

  await assertChipLeftAligned();
  await expect(composer).toBeVisible();
  await captureScreenshot(page, testInfo, "peer-chip-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await chip.scrollIntoViewIfNeeded();
  await expect(chip).toBeVisible();
  await expect(composer).toBeVisible();
  await assertChipLeftAligned();
  await captureScreenshot(page, testInfo, "peer-chip-mobile");

  await chip.focus();
  await expect(chip).toBeFocused();
  await chip.press("Enter");
  const view = page.getByTestId("peer-conversation-view");
  await expect(view).toBeVisible();
  await expect(view.getByRole("heading", { name: /Chief · Researcher/ })).toBeVisible();
  await expect(view.getByText("This chat is view-only")).toBeVisible();
  await expect(view.getByText("Please confirm receipt of the launch brief.").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(view.getByRole("textbox")).toHaveCount(0);
  await expect(view.getByText("Loading")).toHaveCount(0);
  const peerTranscript = view.getByTestId("peer-conversation-transcript");
  await peerTranscript.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      peerTranscript.evaluate(
        (element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
  await captureScreenshot(page, testInfo, "peer-view-only");
});
