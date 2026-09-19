export type SpaceBoundaryLocation = {
  pathname: string;
  search: string;
  assign: (url: string) => void;
  reload: () => void;
};

/** True when the selected space changed, or the shell is still showing a different one. */
export function spaceBoundaryChanged(
  selectedBefore: string | null,
  currentSpaceId: string | undefined,
  nextSpaceId: string,
): boolean {
  // A click in the space the shell already shows must stay in-app. Stale
  // localStorage used to force a hard remount and drop the navigation.
  if (currentSpaceId === nextSpaceId) return false;
  const previous = selectedBefore ?? currentSpaceId;
  return previous !== nextSpaceId || currentSpaceId !== nextSpaceId;
}

export type SpaceChatNavigation = {
  nextSpaceId: string | undefined;
  mode: "soft" | "boundary";
};

/**
 * Same-space roster clicks always soft-navigate, even when the chat has no
 * space id or storage cannot be written. Only a real space change remounts.
 */
export function resolveSpaceChatNavigation(
  chatSpaceId: string | undefined,
  currentSpaceId: string | undefined,
  selectedBefore: string | null,
): SpaceChatNavigation {
  const nextSpaceId = chatSpaceId || currentSpaceId;
  if (!nextSpaceId) return { nextSpaceId: undefined, mode: "soft" };
  if (!spaceBoundaryChanged(selectedBefore, currentSpaceId, nextSpaceId)) {
    return { nextSpaceId, mode: "soft" };
  }
  return { nextSpaceId, mode: "boundary" };
}

/**
 * Crossing a space boundary must remount bootstrap so RPC headers match the
 * roster. `location.assign("/app")` while already on `/app` is a same-document
 * navigation and browsers skip the reload — the switch then never applies.
 */
export function navigateSpaceBoundary(
  path: string,
  location: SpaceBoundaryLocation,
): "reload" | "assign" {
  const url = new URL(path, "https://cadre.invalid");
  if (url.origin !== "https://cadre.invalid") {
    throw new Error("Space navigation must stay on this origin");
  }
  const sameDocument = url.pathname === location.pathname && url.search === location.search;
  if (sameDocument) {
    location.reload();
    return "reload";
  }
  location.assign(`${url.pathname}${url.search}${url.hash}`);
  return "assign";
}
