import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { currentWorkforceAuthority } from "./workforce-authority.js";

export type Db = PrismaClient;

export function createDb(connectionString: string): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const base = new PrismaClient({ adapter });
  const prisma = base.$extends({
    query: {
      run: {
        create({ args, query }) {
          if (process.env.CHIPPI_WORKFORCE_SECRET) {
            const principal = currentWorkforceAuthority();
            if (!principal) throw new Error("Missing Chippi execution authority");
            args.data.workforceAuthority = { ...principal };
          }
          return query(args);
        },
      },
      routine: {
        create({ args, query }) {
          if (process.env.CHIPPI_WORKFORCE_SECRET) {
            const principal = currentWorkforceAuthority();
            if (!principal) throw new Error("Missing Chippi routine authority");
            args.data.workforceAuthority = { ...principal };
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  return { prisma, pool };
}

export type { Pool } from "pg";
export * from "./generated/prisma/client.js";
export { Prisma, PrismaClient } from "./generated/prisma/client.js";
