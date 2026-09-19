import { describe, expect, it, vi } from "vitest";
import {
  readUsageBannerDismissed,
  usageBannerDismissedStorageKey,
  writeUsageBannerDismissed,
} from "./usage-banner-pref";

describe("usage banner dismiss preference", () => {
  it("builds a per-user storage key", () => {
    expect(usageBannerDismissedStorageKey(null)).toBeNull();
    expect(usageBannerDismissedStorageKey("user-1")).toBe("cadre:usage-banner-dismissed:user-1");
  });

  it("reads and writes dismissed state", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    expect(readUsageBannerDismissed("user-1")).toBe(false);
    writeUsageBannerDismissed("user-1", true);
    expect(readUsageBannerDismissed("user-1")).toBe(true);
    writeUsageBannerDismissed("user-1", false);
    expect(readUsageBannerDismissed("user-1")).toBe(false);
    vi.unstubAllGlobals();
  });
});
