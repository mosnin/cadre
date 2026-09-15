import { expect, it, vi } from "vitest";
import { listAgentSkillRecords, skillReadFromTool } from "./skill-tools.js";

const owner = { spaceId: "one", userId: "user" };
const config = {
  format: "cadre-plugin-v1",
  files: [
    {
      path: "skills/design/SKILL.md",
      content: "---\nname: design\ndescription: Design\n---\nRead ../../kernel/guide.md",
    },
    { path: "kernel/guide.md", content: "Workspace-private guide" },
  ],
};
function db() {
  const row = { id: "plugin-one", name: "Design", config, ...owner, kind: "plugin" };
  const matches = (where: Record<string, string>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value);
  return {
    agentSkill: { findMany: vi.fn(async () => []) },
    capabilityInstall: {
      findMany: vi.fn(async ({ where }) => (matches(where) ? [row] : [])),
      findFirst: vi.fn(async ({ where }) => (matches(where) ? row : null)),
    },
  };
}
it("makes imported skills discoverable and reads nested references in the same workspace", async () => {
  const prisma = db();
  const catalog = await listAgentSkillRecords(prisma as never, owner);
  const plugin = catalog.find((entry) => entry.source === "plugin")!;
  expect(plugin).toBeDefined();
  const read = await skillReadFromTool(prisma as never, owner, {
    skillId: plugin.id,
    resourcePath: "../../kernel/guide.md",
  });
  expect(read).toMatchObject({ content: "Workspace-private guide", path: "kernel/guide.md" });
  expect(
    await skillReadFromTool(prisma as never, { ...owner, spaceId: "two" }, { skillId: plugin.id }),
  ).toEqual({ error: "Skill not found." });
  expect(
    await skillReadFromTool(prisma as never, { ...owner, userId: "other" }, { skillId: plugin.id }),
  ).toEqual({ error: "Skill not found." });
  expect(
    await skillReadFromTool(prisma as never, owner, {
      skillId: plugin.id,
      resourcePath: "../../../secret",
    }),
  ).toHaveProperty("error");
});

it("editable copies retain scoped access to plugin references", async () => {
  const prisma = db();
  const content =
    "---\nname: My workflow\ndescription: Adapted workflow\ncadre-plugin-id: plugin-one\ncadre-plugin-entry: skills/design/SKILL.md\n---\nMy edited steps";
  prisma.agentSkill.findMany.mockImplementation(
    async () =>
      [
        {
          id: "copy",
          ...owner,
          name: "My workflow",
          description: "Adapted workflow",
          source: "user",
          content,
        },
      ] as never,
  );
  const read = await skillReadFromTool(prisma as never, owner, { skillId: "copy" });
  expect(read).toMatchObject({ content, readOnly: false });
  expect(
    await skillReadFromTool(prisma as never, owner, {
      skillId: "copy",
      resourcePath: "../../kernel/guide.md",
    }),
  ).toMatchObject({ content: "Workspace-private guide" });
  expect(
    await skillReadFromTool(
      prisma as never,
      { ...owner, spaceId: "two" },
      { skillId: "copy", resourcePath: "../../kernel/guide.md" },
    ),
  ).toHaveProperty("error");
});
