import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { beforeEach, expect, it, vi } from "vitest";
import type { createRouter } from "./router.js";

const mocks = vi.hoisted(() => ({
  getBot: vi.fn(),
  listBots: vi.fn(),
  createBot: vi.fn(),
  call: vi.fn(),
}));
vi.mock("@rakazo/db", async (original) => ({
  ...(await original<object>()),
  createRepos: () => mocks,
}));
vi.mock("@orpc/server", async (original) => ({ ...(await original<object>()), call: mocks.call }));

import { createVoiceToolExecutor } from "./voice-tools.js";

const router = {
  threads: { get: "get", send: "send", answer: "answer", stop: "stop" },
  computer: { release: "release" },
  connections: { list: "connections" },
} as unknown as ReturnType<typeof createRouter>;
const actor = { userId: "user", spaceId: "space" } as Actor;
const snapshot = { run: null, messages: [] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getBot.mockImplementation(async (_actor, id) => {
    if (id === "foreign") throw new Error("Resource not found");
    return { id };
  });
  mocks.call.mockImplementation(async (method) => (method === "get" ? snapshot : {}));
});
function fixture() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const execute = createVoiceToolExecutor(router, {
    bot: { findFirst },
  } as unknown as PrismaClient);
  const run = (name: string, args: Record<string, unknown> = {}, callId = "call") =>
    execute(actor, { botId: "selected", callId, name, args }, new AbortController().signal);
  return { run, findFirst };
}
it("delegates through the durable chat API with scoped actor and stable replay nonce", async () => {
  const { run } = fixture();
  await run("delegate_task", { agentId: "helper", request: "Research this" });
  await run("delegate_task", { agentId: "helper", request: "Research this" });
  const sends = mocks.call.mock.calls.filter(([name]) => name === "send");
  expect(sends).toHaveLength(2);
  expect(sends[0]?.[1]).toMatchObject({
    botId: "helper",
    text: "Research this",
    clientNonce: expect.stringMatching(/^voice:/),
  });
  expect(sends[0]?.[1].clientNonce).toBe(sends[1]?.[1].clientNonce);
  expect(sends[0]?.[2].context.actor).toBe(actor);
});
it("reuses the same persistent agent on replay and dispatches its task", async () => {
  const { run, findFirst } = fixture();
  mocks.createBot.mockResolvedValue({ id: "created", archivedAt: null });
  await run("spawn_agent", { name: "Research", request: "Research this" });
  findFirst.mockResolvedValue({ id: "created", archivedAt: null });
  await run("spawn_agent", { name: "Research", request: "Research this" });
  expect(mocks.createBot).toHaveBeenCalledOnce();
  expect(mocks.createBot.mock.calls[0]?.[1]).toMatchObject({
    parentBotId: "selected",
    computerMode: "team",
  });
  expect(mocks.call).toHaveBeenCalledWith(
    "send",
    expect.objectContaining({ botId: "created" }),
    expect.anything(),
  );
});
it("checks agent ownership before reading status or changing work", async () => {
  const { run } = fixture();
  for (const name of ["task_status", "delegate_task", "stop_task"])
    await expect(run(name, { agentId: "foreign", request: "work" })).rejects.toThrow(
      "Resource not found",
    );
  expect(mocks.call).not.toHaveBeenCalled();
});
it("fetches current task status each time", async () => {
  const { run } = fixture();
  mocks.call
    .mockResolvedValueOnce({ run: { id: "run", status: "running" }, messages: [] })
    .mockResolvedValueOnce({ run: null, messages: [] });
  expect(await run("task_status")).toMatchObject({ status: "running" });
  expect(await run("task_status")).toMatchObject({ status: "idle" });
});
it("rejects unknown actions and empty work without dispatch", async () => {
  const { run } = fixture();
  await expect(run("shell", {})).rejects.toThrow();
  await expect(run("start_task", { request: " " })).rejects.toThrow();
  expect(mocks.call.mock.calls.some(([method]) => method === "send")).toBe(false);
});

it("keeps secret input on screen and ignores obsolete asks from finished runs", async () => {
  const { run } = fixture();
  const message = {
    id: "secret-ask",
    runId: "old-run",
    role: "bot",
    blocks: [{ kind: "ask", input: "secret", status: "pending", text: "Enter password" }],
  };
  mocks.call.mockResolvedValueOnce({
    run: { id: "old-run", status: "waiting_input" },
    messages: [message],
  });
  expect(await run("start_task", { request: "my secret" })).toMatchObject({
    status: "waiting_input",
  });
  expect(mocks.call.mock.calls.some(([method]) => method === "answer" || method === "send")).toBe(
    false,
  );
  mocks.call.mockResolvedValueOnce({ run: null, messages: [message] });
  await run("start_task", { request: "new work" });
  expect(mocks.call).toHaveBeenCalledWith(
    "send",
    expect.objectContaining({ text: "new work" }),
    expect.anything(),
  );
});
