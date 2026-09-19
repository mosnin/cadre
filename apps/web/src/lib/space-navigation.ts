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
  const previous = selectedBefore ?? currentSpaceId;
  return previous !== nextSpaceId || currentSpaceId !== nextSpaceId;
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
