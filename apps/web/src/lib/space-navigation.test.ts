import { describe, expect, it, vi } from "vitest";
import { navigateSpaceBoundary, spaceBoundaryChanged } from "./space-navigation.js";

describe("spaceBoundaryChanged", () => {
  it("detects a switch away from the stored space", () => {
    expect(spaceBoundaryChanged("space-personal", "space-personal", "space-support")).toBe(true);
  });

  it("detects a switch when storage has never been written", () => {
    expect(spaceBoundaryChanged(null, "space-personal", "space-support")).toBe(true);
  });

  it("reloads when storage already has the target but the shell is stale", () => {
    expect(spaceBoundaryChanged("space-support", "space-personal", "space-support")).toBe(true);
  });

  it("stays in-app when the shell is already on the target", () => {
    expect(spaceBoundaryChanged("space-personal", "space-personal", "space-personal")).toBe(false);
  });
});

describe("navigateSpaceBoundary", () => {
  it("reloads when assign would stay on the same document", () => {
    const location = {
      pathname: "/app",
      search: "",
      assign: vi.fn(),
      reload: vi.fn(),
    };

    expect(navigateSpaceBoundary("/app", location)).toBe("reload");
    expect(location.reload).toHaveBeenCalledOnce();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it("assigns when the path actually changes", () => {
    const location = {
      pathname: "/app/bot-1",
      search: "",
      assign: vi.fn(),
      reload: vi.fn(),
    };

    expect(navigateSpaceBoundary("/app", location)).toBe("assign");
    expect(location.assign).toHaveBeenCalledWith("/app");
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("reloads when only the query would match the current document", () => {
    const location = {
      pathname: "/onboarding",
      search: "?new=1",
      assign: vi.fn(),
      reload: vi.fn(),
    };

    expect(navigateSpaceBoundary("/onboarding?new=1", location)).toBe("reload");
    expect(location.reload).toHaveBeenCalledOnce();
  });

  it("rejects an absolute URL on another origin", () => {
    const location = {
      pathname: "/app",
      search: "",
      assign: vi.fn(),
      reload: vi.fn(),
    };

    expect(() => navigateSpaceBoundary("https://example.test/app", location)).toThrow(
      /this origin/,
    );
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });
});
