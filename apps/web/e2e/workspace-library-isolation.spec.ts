import { expect, test } from "@playwright/test";
import { completeOnboarding, rpc, signup } from "./helpers";

test("plugin imports are atomic and private to their owner and workspace", async ({
  page,
  browser,
}) => {
  await signup(page, `library-isolation-${Date.now()}@rakazo.test`, "password12", "Library Owner");
  await completeOnboarding(page);
  const config = {
    files: [
      {
        path: "SKILL.md",
        content:
          "---\nname: Review\ndescription: Review current workspace\n---\nRead the current company context.",
      },
    ],
  };
  const install = () =>
    page.request.post("/rpc/capabilities/install", {
      data: {
        json: { kind: "plugin", name: "Private toolkit", source: "workspace-upload", config },
      },
    });
  const responses = await Promise.all([install(), install()]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const success = responses.find((response) => response.ok())!;
  const { json: plugin } = await success.json();
  const catalog = await rpc<Array<{ id: string; source: string }>>(page, "agentSkills/list");
  const skill = catalog.find((entry) => entry.source === "plugin")!;
  expect(skill).toBeDefined();
  const other = await rpc<{ id: string }>(page, "spaces/create", { name: "Other company" });
  const headers = { "x-rakazo-space-id": other.id };
  const isolatedList = await page.request.post("/rpc/agentSkills/list", {
    headers,
    data: { json: {} },
  });
  expect(
    (await isolatedList.json()).json.every(
      (entry: { source: string }) => entry.source === "builtin",
    ),
  ).toBe(true);
  const deniedRead = await page.request.post("/rpc/agentSkills/get", {
    headers,
    data: { json: { skillId: skill.id } },
  });
  expect(deniedRead.status()).toBe(404);
  const deniedRemoval = await page.request.post("/rpc/capabilities/remove", {
    headers,
    data: { json: { id: plugin.id } },
  });
  // Removal is idempotent and does not reveal whether another workspace owns the ID.
  expect(deniedRemoval.status()).toBe(200);
  expect(
    (await rpc<Array<{ id: string }>>(page, "capabilities/list")).some(
      (entry) => entry.id === plugin.id,
    ),
  ).toBe(true);

  const stranger = await browser.newContext();
  try {
    const second = await stranger.newPage();
    await signup(second, `library-stranger-${Date.now()}@rakazo.test`, "password12", "Other Owner");
    await completeOnboarding(second);
    expect(
      (
        await second.request.post("/rpc/agentSkills/get", { data: { json: { skillId: skill.id } } })
      ).status(),
    ).toBe(404);
    expect(await rpc(second, "capabilities/list")).toEqual([]);
  } finally {
    await stranger.close();
  }
});
