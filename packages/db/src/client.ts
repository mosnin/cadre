import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

/** `DATABASE_POOL_MAX`: connections one process may hold. Unset or invalid keeps pg's default (10). */
export function poolMaxFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = Number(env.DATABASE_POOL_MAX);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 500) : undefined;
}

export function createDb(
  connectionString: string,
  options: { poolMax?: number } = {},
): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString, max: options.poolMax ?? poolMaxFromEnv() });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

export type { Pool } from "pg";
export * from "./generated/prisma/client.js";
export { Prisma, PrismaClient } from "./generated/prisma/client.js";
