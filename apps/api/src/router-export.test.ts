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

function setup(
  state = "running",
  fails = false,
  kind = "fly",
  providerRef: string | null = "vm-test",
) {
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
            kind,
            providerRef,
            scope: "dedicated",
            homeKey: "home-test",
            state,
          },
        }),
      },
      memoryDocument: { findMany: vi.fn().mockResolvedValue([]) },
      routine: { findMany: vi.fn().mockResolvedValue([]) },
      message: { findMany: vi.fn().mockResolvedValue([]) },
    },
    sandbox: {
      exportWorkspace,
      requiresRunningForWorkspaceAccess: ({ kind }: { kind: string }) => kind === "fly",
    },
    home: {
      exportHome,
      list: vi.fn().mockResolvedValue([{ path: "backup.txt", kind: "file", size: 16 }]),
      readFile: vi.fn().mockResolvedValue("older checkpoint"),
    },
    env: { defaultProvider: "fake", defaultModel: "fake-model" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const call = (method = "export/bot") =>
    handler.handle(
      new Request(`http://localhost/rpc/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: { botId: "bot-test", ...(method === "export/bot" ? {} : { path: "backup.txt" }) },
        }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
  return { call, exportWorkspace, exportHome, home: deps.home };
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
    const { call, exportWorkspace } = setup("stopped", false, "fake");
    const { response } = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).json.files).toEqual([
      { path: "backup.txt", content: "older checkpoint" },
    ]);
    expect(exportWorkspace).not.toHaveBeenCalled();
  });
  it.each(["stopped", "suspended", "error", "booting", "suspending"])(
    "refuses stale volume files while %s, including a missing machine reference",
    async (state) => {
      for (const ref of ["vm-test", null]) {
        for (const method of ["computer/files", "computer/readFile", "export/bot"]) {
          const { call, exportWorkspace, exportHome, home } = setup(state, false, "fly", ref);
          const { response } = await call(method);
          expect(response.status).toBe(409);
          expect((await response.json()).json.message).toBe(
            "Start computer to access current files",
          );
          expect(exportWorkspace).not.toHaveBeenCalled();
          expect(exportHome).not.toHaveBeenCalled();
          expect(home.list).not.toHaveBeenCalled();
          expect(home.readFile).not.toHaveBeenCalled();
        }
      }
    },
  );
  it("refuses a running durable record without a reachable machine reference", async () => {
    const { call, exportHome } = setup("running", false, "fly", null);
    const { response } = await call();
    expect(response.status).toBe(409);
    expect(exportHome).not.toHaveBeenCalled();
  });
  it.each(["fake", "desktop", "modal"])(
    "preserves stopped %s file list and preview access",
    async (kind) => {
      const { call } = setup("stopped", false, kind);
      expect((await call("computer/files")).response.status).toBe(200);
      const { response } = await call("computer/readFile");
      expect(response.status).toBe(200);
      expect((await response.json()).json.content).toBe("older checkpoint");
    },
  );
  it("does not silently substitute stale files when the live export fails", async () => {
    const { call, exportHome } = setup("running", true);
    const { response } = await call();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(exportHome).not.toHaveBeenCalled();
  });
});
