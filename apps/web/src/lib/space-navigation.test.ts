import { describe, expect, it, vi } from "vitest";
import {
  navigateSpaceBoundary,
  resolveSpaceChatNavigation,
  spaceBoundaryChanged,
} from "./space-navigation.js";

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

  it("stays in-app when the click is in the space the shell already shows", () => {
    expect(spaceBoundaryChanged("space-stale", "space-personal", "space-personal")).toBe(false);
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

describe("resolveSpaceChatNavigation", () => {
  it("soft-navigates a same-space roster click even when storage is stale", () => {
    expect(resolveSpaceChatNavigation("space-personal", "space-personal", "space-stale")).toEqual({
      nextSpaceId: "space-personal",
      mode: "soft",
    });
  });

  it("soft-navigates when the chat has no space id", () => {
    expect(resolveSpaceChatNavigation(undefined, "space-personal", "space-personal")).toEqual({
      nextSpaceId: "space-personal",
      mode: "soft",
    });
  });

  it("soft-navigates when no space can be resolved", () => {
    expect(resolveSpaceChatNavigation(undefined, undefined, null)).toEqual({
      nextSpaceId: undefined,
      mode: "soft",
    });
  });

  it("remounts when the click is in a different space", () => {
    expect(resolveSpaceChatNavigation("space-support", "space-personal", "space-personal")).toEqual({
      nextSpaceId: "space-support",
      mode: "boundary",
    });
  });
});
