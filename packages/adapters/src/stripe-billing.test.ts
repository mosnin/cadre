import { describe, expect, it, vi } from "vitest";
import { StripeBillingProvider, stripeMinorUnitDigits } from "./stripe-billing.js";

describe("Stripe billing boundary", () => {
  const subscription = {
    id: "sub_test",
    customer: "cus_test",
    status: "active",
    cancel_at_period_end: false,
  };
  it("binds cancellation to the customer and uses provider idempotency", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify(subscription)));
    const provider = new StripeBillingProvider("offline-key", transport);
    await provider.setCancellation({
      customerId: "cus_test",
      subscriptionId: "sub_test",
      cancelAtPeriodEnd: true,
      operationId: "operation-test",
    });
    expect(transport).toHaveBeenCalledTimes(2);
    const [url, init] = transport.mock.calls[1]!;
    expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_test");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { "Idempotency-Key": "cadre-admin-operation-test" },
    });
    expect(String(init?.body)).toBe("cancel_at_period_end=true");
  });
  it("refuses a subscription owned by another customer before mutation", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...subscription, customer: "cus_other" })));
    const provider = new StripeBillingProvider("offline-key", transport);
    await expect(
      provider.setCancellation({
        customerId: "cus_test",
        subscriptionId: "sub_test",
        cancelAtPeriodEnd: true,
        operationId: "operation-test",
      }),
    ).rejects.toThrow("does not belong");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects URL injection and does not disclose provider error bodies", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private-provider-diagnostic", { status: 400 }));
    const provider = new StripeBillingProvider("offline-key", transport);
    await expect(provider.customer("https://example.test/steal")).rejects.toThrow(
      "Invalid customer",
    );
    expect(transport).not.toHaveBeenCalled();
    await expect(provider.customer("cus_test")).rejects.toThrow("Billing provider request failed.");
  });
  it("returns validated customer metadata and provider-specific amount units", async () => {
    const transport = vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).includes("/customers/")
          ? { id: "cus_test", email: "billing@example.test", livemode: false }
          : String(url).includes("/subscriptions?")
            ? { data: [subscription] }
            : {
                data: [
                  {
                    id: "in_test",
                    customer: "cus_test",
                    number: null,
                    status: "paid",
                    amount_due: 500,
                    amount_paid: 500,
                    currency: "isk",
                    created: 1,
                  },
                ],
              },
      ),
    );
    const snapshot = await new StripeBillingProvider("offline-key", transport).customer("cus_test");
    expect(snapshot.dashboardUrl).toBe("https://dashboard.stripe.com/test/customers/cus_test");
    expect(snapshot.invoices[0]).toMatchObject({ amountPaid: 500, minorUnitDigits: 2 });
  });
  it.each([
    ["usd", 2],
    ["jpy", 0],
    ["isk", 2],
    ["ugx", 2],
    ["kwd", 3],
    ["huf", 2],
    ["twd", 2],
  ])("normalizes %s API units", (currency, digits) => {
    expect(stripeMinorUnitDigits(String(currency))).toBe(digits);
  });
});
