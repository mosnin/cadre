import type { BillingSnapshot } from "@rakazo/contracts";

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
