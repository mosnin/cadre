import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSetupDraft,
  saveSetupDraft,
  setupDraftKey,
  type WorkspaceSetupDraft,
} from "./workspace-setup-draft";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}
const draft = (): WorkspaceSetupDraft => ({
  step: "bot",
  workspaceName: "Studio",
  name: "Researcher",
  title: "",
  description: "Research",
  savedAt: Date.now(),
});
describe("unfinished workspace setup", () => {
  it("keeps drafts separate by account and workspace and clears completed setup", () => {
    storage();
    const key = setupDraftKey("one", "studio");
    saveSetupDraft(key, draft());
    expect(readSetupDraft(key)?.name).toBe("Researcher");
    expect(readSetupDraft(setupDraftKey("two", "studio"))).toBeNull();
    expect(readSetupDraft(setupDraftKey("one", "other"))).toBeNull();
    saveSetupDraft(key, null);
    expect(readSetupDraft(key)).toBeNull();
  });
  it("rejects stale, invalid, and future drafts", () => {
    const values = storage();
    for (const value of [
      { ...draft(), savedAt: Date.now() - 86400001 },
      { ...draft(), savedAt: Date.now() + 60000 },
      { ...draft(), step: "unknown" },
      { ...draft(), name: 42 },
    ]) {
      values.set("draft", JSON.stringify(value));
      expect(readSetupDraft("draft")).toBeNull();
    }
    values.set("draft", "broken json");
    expect(readSetupDraft("draft")).toBeNull();
  });
  it("allows setup to continue when browser storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    });
    expect(readSetupDraft("draft")).toBeNull();
    expect(() => saveSetupDraft("draft", draft())).not.toThrow();
    expect(() => saveSetupDraft("draft", null)).not.toThrow();
  });
});
