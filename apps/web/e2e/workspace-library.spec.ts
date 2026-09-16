import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openNavigation, rpc, signup } from "./helpers";

test("workspace library saves edits and imports complete plugin references", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signup(page, `library-${Date.now()}@rakazo.test`, "password12", "Library Owner");
  await completeOnboarding(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openNavigation(page);
  await page.getByRole("button", { name: "Workspace library", exact: true }).click();
  const library = page.getByRole("dialog");
  await expect(library).toHaveAccessibleName("Workspace library");
  await library.getByRole("button", { name: "New skill or workflow" }).click();
  await library.getByLabel("Name", { exact: true }).fill("Weekly review");
  await library.getByLabel("When to use it").fill("Review completed work each week");
  await library
    .getByLabel("Steps and instructions")
    .fill("1. Read completed tasks.\n2. Summarize what changed.");
  await library.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    library.getByRole("button", { name: /Weekly review Review completed/ }),
  ).toBeVisible();
  await library.getByRole("button", { name: /Weekly review Review completed/ }).click();
  await library
    .getByLabel("SKILL.md")
    .fill(
      "---\nname: Weekly review\ndescription: Review completed work each week\n---\n1. Read tasks.\n2. Identify blockers.",
    );
  await page.route("**/rpc/agentSkills/list", (route) => route.abort("failed"));
  await library.getByRole("button", { name: "Save", exact: true }).click();
  await expect(library.getByRole("alert")).toHaveText(
    "Changes saved. Reload the library to see them.",
  );
  await page.unroute("**/rpc/agentSkills/list");
  await library.getByRole("button", { name: "Reload library", exact: true }).click();
  await expect(library.getByRole("alert")).toHaveCount(0);
  const saved = await rpc<{ content: string }>(page, "agentSkills/get", { name: "Weekly review" });
  expect(saved.content).toContain("Identify blockers");
  const folder = await mkdtemp(join(tmpdir(), "cadre-plugin-test-"));
  try {
    await mkdir(join(folder, "skills", "design"), { recursive: true });
    await mkdir(join(folder, "kernel"));
    await writeFile(
      join(folder, "skills", "design", "SKILL.md"),
      "---\nname: Design\ndescription: Design useful products\n---\nRead ../../kernel/guide.md",
    );
    await writeFile(
      join(folder, "kernel", "guide.md"),
      "1. Map the user's workflow.\n2. Test the interface.",
    );
    await library.getByRole("button", { name: "Import plugin", exact: true }).click();
    const folderPicker = page.waitForEvent("filechooser");
    await library.getByRole("button", { name: "Choose folder", exact: true }).click();
    await (await folderPicker).setFiles(folder);
    await library.getByLabel("Plugin name").fill("Design toolkit");
    await expect(library.getByText(/2 files will be saved/)).toBeVisible();
    await library.getByRole("button", { name: "Import plugin", exact: true }).click();
    await expect(library.getByRole("button", { name: /Design toolkit\/Design/ })).toBeVisible();
    await captureScreenshot(page, testInfo, "workspace-library-dark");
    const installs = await rpc<Array<{ id: string; name: string; config: { files: unknown[] } }>>(
      page,
      "capabilities/list",
    );
    expect(installs.find((item) => item.name === "Design toolkit")?.config.files).toHaveLength(2);
    await library.getByRole("button", { name: /Design toolkit\/Design/ }).click();
    await expect(library.getByLabel("SKILL.md")).toHaveAttribute("readonly", "");
    await expect(library.getByLabel("SKILL.md")).toContainText("../../kernel/guide.md");
    await library.getByRole("button", { name: "Make a copy" }).click();
    await library.getByLabel("Name", { exact: true }).fill("Studio design review");
    await library.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      library.getByRole("button", { name: /Studio design review Design useful/ }),
    ).toBeVisible();
    const copy = await rpc<{ content: string }>(page, "agentSkills/get", {
      name: "Studio design review",
    });
    expect(copy.content).toContain("cadre-plugin-id:");
    expect(copy.content).toContain("skills/design/SKILL.md");
    const downloadPromise = page.waitForEvent("download");
    await library.getByRole("button", { name: "Export Design toolkit", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Design-toolkit.json");
    await download.saveAs(join(folder, "export.json"));
    await page.setViewportSize({ width: 390, height: 844 });
    await library
      .locator('input[accept=".json,application/json"]')
      .setInputFiles(join(folder, "export.json"));
    await library.getByLabel("Plugin name").fill("Phone toolkit");
    await library.getByRole("button", { name: "Import plugin", exact: true }).click();
    await expect(library.getByRole("button", { name: /Phone toolkit\/Design/ })).toBeVisible();
    await captureScreenshot(page, testInfo, "workspace-library-phone");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
