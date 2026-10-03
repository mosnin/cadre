import { Prisma } from "@cadre/db";
import { vi } from "vitest";

/**
 * A small in-memory stand-in for the Prisma tables sub-agents touch, with just enough of the
 * query language (equality, in, not, comparisons, OR/AND, the parent and task relations) for
 * the orchestration code to run against it deterministically and offline.
 */
type Row = Record<string, unknown> & { id: string };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function isDbNull(value: unknown) {
  return value === Prisma.DbNull || value === Prisma.JsonNull;
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x === y ? 0 : x < y ? -1 : 1;
}

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond === null) return value == null;
  if (cond instanceof Date || typeof cond !== "object") {
    return cond instanceof Date && value instanceof Date
      ? value.getTime() === cond.getTime()
      : value === cond;
  }
  const ops = cond as Record<string, unknown>;
  for (const [op, expected] of Object.entries(ops)) {
    if (op === "in") {
      if (!(expected as unknown[]).includes(value)) return false;
    } else if (op === "not") {
      if (expected === null || isDbNull(expected)) {
        if (value == null) return false;
      } else if (matchValue(value, expected)) return false;
    } else if (op === "equals") {
      if (!matchValue(value, expected)) return false;
    } else if (op === "gte") {
      if (value == null || compare(value, expected) < 0) return false;
    } else if (op === "lte") {
      if (value == null || compare(value, expected) > 0) return false;
    } else if (op === "gt") {
      if (value == null || compare(value, expected) <= 0) return false;
    } else if (op === "lt") {
      if (value == null || compare(value, expected) >= 0) return false;
    }
  }
  return true;
}

export function createFakeDb() {
  const tables = {
    run: [] as Row[],
    task: [] as Row[],
    agentTask: [] as Row[],
    usageRecord: [] as Row[],
    message: [] as Row[],
    event: [] as Row[],
    bot: [] as Row[],
  };
  const threads = new Map<string, { nextEventSeq: number; nextMessageSeq: number }>();

  const relation = (table: keyof typeof tables, row: Row, key: string): Row | undefined => {
    if (table === "run" && key === "parent") {
      return tables.run.find((candidate) => candidate.id === row.parentRunId);
    }
    if (table === "run" && key === "task") {
      return tables.task.find((candidate) => candidate.id === row.taskId);
    }
    return undefined;
  };

  const matches = (
    table: keyof typeof tables,
    row: Row,
    where: Record<string, unknown>,
  ): boolean => {
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue;
      if (key === "OR") {
        if (!(cond as Record<string, unknown>[]).some((part) => matches(table, row, part))) {
          return false;
        }
      } else if (key === "AND") {
        if (!(cond as Record<string, unknown>[]).every((part) => matches(table, row, part))) {
          return false;
        }
      } else if (key === "parent" || key === "task") {
        const related = relation(table, row, key);
        if (!related) return false;
        if (!matches(key === "parent" ? "run" : "task", related, cond as Record<string, unknown>)) {
          return false;
        }
      } else if (!matchValue(row[key], cond)) return false;
    }
    return true;
  };

  const applyData = (row: Row, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = isDbNull(value) ? null : value;
    }
    row.updatedAt = new Date();
  };

  const runDefaults = (): Record<string, unknown> => ({
    status: "queued",
    trigger: "user",
    leaseOwner: null,
    leaseFence: 0,
    leaseExpiresAt: null,
    checkpoint: null,
    segment: 1,
    progressNote: null,
    clientNonce: null,
    sourceMessageId: null,
    routineId: null,
    startedAt: null,
    completedAt: null,
    error: null,
    modelId: null,
    modelProvider: null,
    parentRunId: null,
    rootRunId: null,
    parentToolCallId: null,
    subagentDepth: 0,
    agentType: null,
    agentLabel: null,
    agentResult: null,
    agentResultDeliveredAt: null,
    agentBackground: null,
    agentInbox: null,
    agentWait: null,
    agentWaitKey: null,
    guardrailState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const model = (table: keyof typeof tables, defaults: () => Record<string, unknown>) => ({
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const key = Object.keys(where)[0]!;
      return tables[table].find((row) => row[key] === where[key]) ?? null;
    }),
    findFirst: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        tables[table].find((row) => matches(table, row, where ?? {})) ?? null,
    ),
    findMany: vi.fn(
      async ({ where, take }: { where?: Record<string, unknown>; take?: number } = {}) => {
        const rows = tables[table].filter((row) => matches(table, row, where ?? {}));
        return take ? rows.slice(0, take) : rows;
      },
    ),
    count: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        tables[table].filter((row) => matches(table, row, where ?? {})).length,
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: Row = { id: nextId(table), ...defaults(), ...data } as Row;
      if (table === "run") {
        const nonce = row.clientNonce as string | null;
        const duplicate = tables.run.some(
          (other) =>
            (nonce && other.clientNonce === nonce && other.spaceId === row.spaceId) ||
            (row.parentRunId &&
              row.parentToolCallId &&
              other.parentRunId === row.parentRunId &&
              other.parentToolCallId === row.parentToolCallId),
        );
        if (duplicate) throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      for (const [key, value] of Object.entries(row)) if (isDbNull(value)) row[key] = null;
      tables[table].push(row);
      return row;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const key = Object.keys(where)[0]!;
        const row = tables[table].find((candidate) => candidate[key] === where[key]);
        if (!row) throw new Error(`${table} not found`);
        applyData(row, data);
        return row;
      },
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = tables[table].filter((row) => matches(table, row, where ?? {}));
        for (const row of rows) applyData(row, data);
        return { count: rows.length };
      },
    ),
  });

  const prisma = {
    run: {
      ...model("run", runDefaults),
      findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
        const row = await prisma.run.findUnique(args);
        if (!row) throw new Error("run not found");
        return row;
      },
    },
    task: model("task", () => ({ status: "queued", createdAt: new Date() })),
    agentTask: model("agentTask", () => ({
      status: "pending",
      assignedRunId: null,
      result: null,
      notes: null,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    usageRecord: {
      aggregate: vi.fn(async ({ where }: { where: { runId: unknown } }) => {
        const rows = tables.usageRecord.filter((row) => matchValue(row.runId, where.runId));
        return {
          _sum: {
            inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens as number), 0),
            outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens as number), 0),
          },
        };
      }),
    },
    bot: model("bot", () => ({})),
    message: {
      ...model("message", () => ({})),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: nextId("message"), ...data } as Row;
        tables.message.push(row);
        return row;
      }),
    },
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: nextId("event"), createdAt: new Date(), ...data } as Row;
        tables.event.push(row);
        return row;
      }),
    },
    thread: {
      update: vi.fn(async ({ where }: { where: { id: string } }) => {
        const thread = threads.get(where.id) ?? { nextEventSeq: 0, nextMessageSeq: 0 };
        thread.nextEventSeq += 1;
        thread.nextMessageSeq += 1;
        threads.set(where.id, thread);
        return { ...thread };
      }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };

  const events = {
    append: vi.fn(async (input: Record<string, unknown>) => {
      const row: Row = { id: nextId("event"), seq: tables.event.length + 1, ...input } as Row;
      tables.event.push(row);
      return row as unknown as { seq: number };
    }),
    notify: vi.fn(async () => undefined),
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };

  const addRun = (fields: Record<string, unknown>): Row => {
    const taskId = (fields.taskId as string | undefined) ?? nextId("task");
    if (!tables.task.some((task) => task.id === taskId)) {
      tables.task.push({ id: taskId, prompt: "task", status: "queued" });
    }
    const row: Row = {
      id: nextId("run"),
      spaceId: "space-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      taskId,
      ...runDefaults(),
      ...fields,
    } as Row;
    tables.run.push(row);
    return row;
  };

  tables.bot.push({ id: "bot-1", name: "Atlas" }, { id: "bot-2", name: "Beacon" });
  return { prisma, events, jobs, tables, addRun, deps: { prisma, events, jobs } as never };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
