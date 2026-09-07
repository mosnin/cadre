import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkforcePrincipal } from "@rakazo/core/node/workforce-auth";

const authority = new AsyncLocalStorage<WorkforcePrincipal>();
export const currentWorkforceAuthority = () => authority.getStore();
export function withWorkforceAuthority<T>(
  principal: WorkforcePrincipal | undefined,
  work: () => T,
): T {
  return principal ? authority.run(principal, work) : work();
}
