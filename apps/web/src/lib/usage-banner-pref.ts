const STORAGE_PREFIX = "cadre:usage-banner-dismissed:";

export function usageBannerDismissedStorageKey(userId: string | null | undefined): string {
  return userId ? `${STORAGE_PREFIX}${userId}` : `${STORAGE_PREFIX}local`;
}

export function readUsageBannerDismissed(userId: string | null | undefined): boolean {
  const storageKey = usageBannerDismissedStorageKey(userId);
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

export function writeUsageBannerDismissed(
  userId: string | null | undefined,
  dismissed: boolean,
): void {
  const storageKey = usageBannerDismissedStorageKey(userId);
  try {
    if (dismissed) window.localStorage.setItem(storageKey, "1");
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore quota / private-mode failures; in-memory state still applies.
  }
}
