import { abortableDelay } from "./async.js";

/** Follow a durable startup without issuing another boot or reviving a later Stop. */
export async function waitForComputerStartup<T extends { state: string }>(
  initial: T,
  readStatus: () => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 210_000);
  let current = initial;
  const timedOut = () =>
    new Error("Computer startup is taking longer than expected. Try opening it again.");
  for (;;) {
    options.signal?.throwIfAborted();
    if (current.state === "running") return current;
    if (current.state !== "booting")
      throw new Error("Computer startup was interrupted. Open the computer again to retry.");
    if (Date.now() >= deadline) throw timedOut();
    await abortableDelay(
      Math.min(options.intervalMs ?? 1000, deadline - Date.now()),
      options.signal,
    );
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw timedOut();
    current = await new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(options.signal?.reason ?? new Error("Computer startup cancelled"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(timedOut());
      }, deadline - Date.now());
      options.signal?.addEventListener("abort", abort, { once: true });
      // A late read is harmless; observe both outcomes after the caller has left.
      Promise.resolve()
        .then(readStatus)
        .then(
          (status) => {
            cleanup();
            resolve(status);
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
    });
  }
}
