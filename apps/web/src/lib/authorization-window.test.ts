import { afterEach, expect, it, vi } from "vitest";
import { reserveAuthorizationWindow } from "./authorization-window";

afterEach(() => vi.unstubAllGlobals());
it("reserves a window immediately, detaches its opener, then navigates after authorization", async () => {
  const popup = { opener: {}, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
  const open = vi.fn(() => popup);
  vi.stubGlobal("window", { open, location: { assign: vi.fn() } });
  const authorization = reserveAuthorizationWindow();
  expect(open).toHaveBeenCalledOnce();
  expect(popup.opener).toBeNull();
  await Promise.resolve();
  authorization.navigate("https://auth.example.test/connect");
  authorization.closeUnused();
  expect(popup.location.replace).toHaveBeenCalledWith("https://auth.example.test/connect");
  expect(popup.close).not.toHaveBeenCalled();
});
it("uses same-tab authorization if a popup is blocked", () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { open: () => null, location: { assign } });
  reserveAuthorizationWindow().navigate("https://auth.example.test/connect");
  expect(assign).toHaveBeenCalledOnce();
});
it("closes an unused popup on failure or no-auth and rejects executable URLs", () => {
  const popup = { opener: {}, close: vi.fn() };
  vi.stubGlobal("window", { open: () => popup });
  const authorization = reserveAuthorizationWindow();
  expect(() => authorization.navigate("javascript:alert(1)")).toThrow();
  authorization.closeUnused();
  expect(popup.close).toHaveBeenCalledOnce();
});
