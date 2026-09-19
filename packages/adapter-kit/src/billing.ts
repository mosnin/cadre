import type { BillingSnapshot } from "@cadre/contracts";

export interface BillingProvider {
  customer(customerId: string, signal?: AbortSignal): Promise<BillingSnapshot>;
  setCancellation(
    input: {
      customerId: string;
      subscriptionId: string;
      cancelAtPeriodEnd: boolean;
      operationId: string;
    },
    signal?: AbortSignal,
  ): Promise<void>;
}
