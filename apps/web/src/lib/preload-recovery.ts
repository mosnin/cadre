const PRELOAD_RECOVERY_KEY = "rk:preload-recovery";
const PRELOAD_RECOVERY_COOLDOWN_MS = 30_000;

type PreloadRecoveryWindow = Pick<
  Window,
  | "addEventListener"
  | "clearTimeout"
  | "location"
  | "removeEventListener"
  | "sessionStorage"
  | "setTimeout"
>;

/**
 * Vite emits this event when a lazy chunk from an older deployment no longer
 * exists. Reload once so the browser receives the current asset manifest.
 */
export function installPreloadRecovery(target: PreloadRecoveryWindow = window): () => void {
  let attempted = false;
  const clearRecovery = target.setTimeout(() => {
    try {
      target.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY);
    } catch {
      /* Storage can be unavailable in a PWA. */
    }
  }, PRELOAD_RECOVERY_COOLDOWN_MS);
  const onPreloadError = (event: Event) => {
    if (attempted) return;
    try {
      if (target.sessionStorage.getItem(PRELOAD_RECOVERY_KEY)) return;
      target.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, "1");
    } catch {
      // Without a persistent guard, do not risk reloading indefinitely.
      return;
    }
    attempted = true;
    event.preventDefault();
    target.location.reload();
  };

  target.addEventListener("vite:preloadError", onPreloadError);
  return () => {
    target.clearTimeout(clearRecovery);
    target.removeEventListener("vite:preloadError", onPreloadError);
  };
}
