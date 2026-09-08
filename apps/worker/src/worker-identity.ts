import { randomUUID } from "node:crypto";

/** Never put arbitrary deployment environment text into lease IDs or logs. */
export function createWorkerIdentity(gitRevision?: string): {
  id: string;
  revision: string | null;
} {
  const candidate = gitRevision?.trim().toLowerCase();
  const revision =
    candidate && /^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/.test(candidate) ? candidate : null;
  return { id: `worker:${revision ?? "unknown"}:${randomUUID()}`, revision };
}
