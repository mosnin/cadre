import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space-test",
  userId: "user-test",
  email: "user@example.test",
  isDeploymentOwner: true,
};

function setup(state = "running", fails = false) {
  const exportWorkspace = vi.fn(async function* () {
    if (fails) throw new Error("Live workspace unavailable");
    yield { path: "latest.txt", content: new TextEncoder().encode("completed task") };
  });
  const exportHome = vi.fn(async function* () {
    yield { path: "backup.txt", content: new TextEncoder().encode("older checkpoint") };
  });
  const deps = {
    prisma: {
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          id: "bot-test",
          name: "Test bot",
          title: "",
          description: "",
          instructions: "",
          thread: { id: "thread-test" },
          computer: {
            id: "computer-test",
            kind: "fly",
            providerRef: "vm-test",
            homeKey: "home-test",
            state,
          },
        }),
      },
      memoryDocument: { findMany: vi.fn().mockResolvedValue([]) },
      routine: { findMany: vi.fn().mockResolvedValue([]) },
      message: { findMany: vi.fn().mockResolvedValue([]) },
    },
    sandbox: { exportWorkspace },
    home: { exportHome },
    env: { defaultProvider: "fake", defaultModel: "fake-model" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const call = () =>
    handler.handle(
      new Request("http://localhost/rpc/export/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: "bot-test" } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
  return { call, exportWorkspace, exportHome };
}

describe("export current computer files", () => {
  it("exports completed work from the running volume before the next portable checkpoint", async () => {
    const { call, exportWorkspace, exportHome } = setup();
    const { response } = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).json.files).toEqual([
      { path: "latest.txt", content: "completed task" },
    ]);
    expect(exportWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ providerRef: "vm-test" }),
      expect.objectContaining({ spaceId: actor.spaceId, userId: actor.userId, botId: "bot-test" }),
    );
    expect(exportHome).not.toHaveBeenCalled();
  });
  it("uses the saved checkpoint when the computer is stopped", async () => {
    const { call, exportWorkspace } = setup("stopped");
    const { response } = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).json.files).toEqual([
      { path: "backup.txt", content: "older checkpoint" },
    ]);
    expect(exportWorkspace).not.toHaveBeenCalled();
  });
  it("does not silently substitute stale files when the live export fails", async () => {
    const { call, exportHome } = setup("running", true);
    const { response } = await call();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(exportHome).not.toHaveBeenCalled();
  });
});
