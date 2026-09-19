/**
 * Whether the workspace rail is collapsed. Default open: the rail is part of
 * the desktop layout rather than a panel over the conversation, so it is
 * present unless someone has closed it.
 */
export const RAIL_COLLAPSED_KEY = "cadre.railCollapsed";

export function readRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeRailCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(RAIL_COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(RAIL_COLLAPSED_KEY);
  } catch {
    // Private mode / blocked storage — keep in-memory only.
  }
}
