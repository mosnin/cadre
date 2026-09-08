import type { BillingProvider } from "@rakazo/adapter-kit";
import { BillingSnapshotSchema } from "@rakazo/contracts";
import * as z from "zod";

const Customer = z.object({
  id: z.string(),
  email: z.string().nullable(),
  livemode: z.boolean(),
  deleted: z.boolean().optional(),
});
const Subscription = z.object({
  id: z.string(),
  customer: z.string(),
  status: z.string(),
  cancel_at_period_end: z.boolean(),
});
const Invoice = z.object({
  id: z.string(),
  customer: z.string(),
  number: z.string().nullable(),
  status: z.string().nullable(),
  amount_due: z.number().int().safe(),
  amount_paid: z.number().int().safe(),
  currency: z.string().regex(/^[a-z]{3}$/),
  created: z.number().int().nonnegative(),
});

// Stripe retains two-decimal API amounts for ISK and UGX (docs.stripe.com/currencies).
export function stripeMinorUnitDigits(currency: string) {
  if (["ISK", "UGX", "HUF", "TWD"].includes(currency.toUpperCase())) return 2;
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Fixed provider origin; no customer-supplied URLs or payment credentials reach the application. */
export class StripeBillingProvider implements BillingProvider {
  constructor(
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request(
    path: string,
    signal?: AbortSignal,
    body?: URLSearchParams,
    operationId?: string,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(15_000);
    const response = await this.transport(`https://api.stripe.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.key}`,
        "Stripe-Version": "2025-08-27.basil",
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(operationId ? { "Idempotency-Key": `cadre-admin-${operationId}` } : {}),
      },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok)
      throw new Error("Billing provider request failed. Refresh billing before retrying.");
    return response.json();
  }

  async customer(customerId: string, signal?: AbortSignal) {
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error("Invalid customer identifier.");
    const [rawCustomer, rawSubscriptions, rawInvoices] = await Promise.all([
      this.request(`customers/${customerId}`, signal),
      this.request(`subscriptions?customer=${customerId}&status=all&limit=25`, signal),
      this.request(`invoices?customer=${customerId}&limit=25`, signal),
    ]);
    const customer = Customer.parse(rawCustomer);
    const subscriptions = z.object({ data: z.array(Subscription).max(25) }).parse(rawSubscriptions);
    const invoices = z.object({ data: z.array(Invoice).max(25) }).parse(rawInvoices);
    if (
      subscriptions.data.some((row) => row.customer !== customerId) ||
      invoices.data.some((row) => row.customer !== customerId)
    )
      throw new Error("Billing customer mismatch.");
    if (customer.deleted || customer.id !== customerId)
      throw new Error("Billing customer is unavailable.");
    return BillingSnapshotSchema.parse({
      customerId,
      email: customer.email ?? null,
      dashboardUrl: `https://dashboard.stripe.com/${customer.livemode === false ? "test/" : ""}customers/${customerId}`,
      subscriptions: subscriptions.data.map((row) => ({
        id: row.id,
        status: row.status,
        cancelAtPeriodEnd: row.cancel_at_period_end,
      })),
      invoices: invoices.data.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        amountDue: row.amount_due,
        amountPaid: row.amount_paid,
        currency: row.currency,
        minorUnitDigits: stripeMinorUnitDigits(row.currency),
        createdAt: new Date(row.created * 1000).toISOString(),
      })),
    });
  }

  async setCancellation(
    input: {
      customerId: string;
      subscriptionId: string;
      cancelAtPeriodEnd: boolean;
      operationId: string;
    },
    signal?: AbortSignal,
  ) {
    if (
      !/^cus_[A-Za-z0-9]+$/.test(input.customerId) ||
      !/^sub_[A-Za-z0-9]+$/.test(input.subscriptionId)
    )
      throw new Error("Invalid billing identifier.");
    const subscription = Subscription.parse(
      await this.request(`subscriptions/${input.subscriptionId}`, signal),
    );
    if (subscription.customer !== input.customerId)
      throw new Error("Subscription does not belong to this customer.");
    await this.request(
      `subscriptions/${input.subscriptionId}`,
      signal,
      new URLSearchParams({ cancel_at_period_end: String(input.cancelAtPeriodEnd) }),
      input.operationId,
    );
  }
}
