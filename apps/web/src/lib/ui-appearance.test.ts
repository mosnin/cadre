import {
  persistAppearancePreference,
  resolveAppearancePreference,
  UI_APPEARANCE_STORAGE_KEY,
} from "@cadre/ui-tokens";
import { describe, expect, it } from "vitest";
import { applyResolvedAppearance, readSystemAppearance } from "./ui-appearance";

function fakeRoot() {
  const classes = new Set<string>();
  return {
    dataset: {} as DOMStringMap,
    style: { colorScheme: "" },
    classList: {
      toggle: (name: string, on: boolean) => {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      [Symbol.iterator]: () => classes.values(),
    },
  };
}

describe("ui-appearance", () => {
  it("treats matching light media as light", () => {
    expect(readSystemAppearance({ matches: true })).toBe("light");
    expect(readSystemAppearance({ matches: false })).toBe("dark");
  });

  it("writes data-theme and color-scheme on the root", () => {
    const root = fakeRoot();
    applyResolvedAppearance("light", root as unknown as HTMLElement);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  // Vendored components read the Tailwind convention rather than ours, so the
  // class has to track `data-theme` for them to see the dark theme at all.
  it("mirrors the theme onto the root's class list", () => {
    const root = fakeRoot();
    applyResolvedAppearance("dark", root as unknown as HTMLElement);
    expect([...root.classList]).toEqual(["dark"]);
    applyResolvedAppearance("light", root as unknown as HTMLElement);
    expect([...root.classList]).toEqual(["light"]);
  });

  it("persists preference through storage helpers", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    persistAppearancePreference("dark", storage);
    expect(store.get(UI_APPEARANCE_STORAGE_KEY)).toBe("dark");
    expect(resolveAppearancePreference({ storage })).toBe("dark");
  });
});
