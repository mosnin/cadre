import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("command palette opens with keyboard, filters, and switches bots", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `cmdk-bots-${stamp}@cadre.test`, "password12", "CmdK Bots");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const chiefId = activeBotId(page);
  const researcher = await rpc<{ id: string }>(page, "bots/create", {
    name: "Researcher",
    title: "research lead",
    description: "Finds sources and writes briefs.",
    instructions: "",
    notifyOnFinish: true,
    computerMode: "team",
  });
  await page.reload();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByTestId("bots-sidebar")).toBeVisible();

  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByTestId("command-palette");
  const dialog = page.getByRole("dialog", { name: "Switch agent" });
  await expect(dialog).toBeVisible();
  await expect(palette).toBeVisible();
  // The palette lists agents, not tabs. It used to be able to say that of
  // the whole page, because opening it replaced the rail; the rail is part
  // of the layout now and keeps its Conversations/Activity tabs on screen
  // behind the dialog, so the claim is scoped to the dialog, which is where
  // it was always about.
  await expect(dialog.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Chief/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Researcher/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "command-palette-bots");

  const search = page.getByTestId("command-palette-search");
  await search.fill("Research");
  await expect(page.getByRole("option", { name: /Researcher/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Chief/ })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "command-palette-filtered");

  await page.getByRole("option", { name: /Researcher/ }).click();
  await expect(dialog).toBeHidden();
  await page.waitForURL(new RegExp(`/app/${researcher.id}$`));
  expect(activeBotId(page)).toBe(researcher.id);
  await expect(page.getByRole("combobox", { name: "Message Researcher" })).toBeVisible();

  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await page.keyboard.press("ControlOrMeta+K");
  await expect(dialog).toBeVisible();
  await page.getByTestId(`command-palette-bot-${chiefId}`).click();
  await page.waitForURL(new RegExp(`/app/${chiefId}$`));
  expect(activeBotId(page)).toBe(chiefId);
});
