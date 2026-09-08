import type { Prisma } from "./generated/prisma/client.js";

/** Cancel dispatch durably. Existing provider work is released by the fenced worker cleanup. */
export async function cancelUserRuns(
  tx: Prisma.TransactionClient,
  where: { userId: string; id?: string },
) {
  const active = {
    ...where,
    status: { in: ["queued", "leased", "running", "waiting_input", "waiting_takeover"] },
  };
  await tx.task.updateMany({ where: { runs: { some: active } }, data: { status: "cancelled" } });
  await tx.attempt.updateMany({
    where: { run: active, status: "running" },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  await tx.steeringMessage.deleteMany({
    where: { userId: where.userId, ...(where.id ? { runId: where.id } : {}) },
  });
  await tx.run.updateMany({
    where: active,
    data: { status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
  });
}
