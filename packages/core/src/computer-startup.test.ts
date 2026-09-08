import { afterEach, expect, it, vi } from "vitest";
import { waitForComputerStartup } from "./computer-startup.js";

afterEach(() => vi.useRealTimers());

it("waits for durable startup before allowing dependent work", async () => {
  vi.useFakeTimers();
  const poll = vi
    .fn()
    .mockResolvedValueOnce({ state: "booting" })
    .mockResolvedValueOnce({ state: "running" });
  const ready = waitForComputerStartup({ state: "booting" }, poll);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(ready).resolves.toEqual({ state: "running" });
  expect(poll).toHaveBeenCalledTimes(2);
});

it.each(["stopped", "suspended", "error"])(
  "does not restart a computer that became %s",
  async (state) => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ state });
    const failed = expect(waitForComputerStartup({ state: "booting" }, poll)).rejects.toThrow(
      "interrupted",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(poll).toHaveBeenCalledOnce();
  },
);

it("bounds polling and allows a closed view to abort", async () => {
  vi.useFakeTimers();
  const poll = vi.fn().mockResolvedValue({ state: "booting" });
  const failed = expect(
    waitForComputerStartup({ state: "booting" }, poll, { timeoutMs: 1500 }),
  ).rejects.toThrow("longer than expected");
  await vi.advanceTimersByTimeAsync(1500);
  await failed;
  expect(poll).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  const aborted = expect(
    waitForComputerStartup({ state: "booting" }, poll, { signal: controller.signal }),
  ).rejects.toThrow("closed");
  controller.abort(new Error("closed"));
  await aborted;
  expect(poll).toHaveBeenCalledTimes(1);
});

it("ends a stalled status read at the deadline and observes a late rejection", async () => {
  vi.useFakeTimers();
  let rejectRead!: (error: Error) => void;
  const poll = vi.fn(
    () =>
      new Promise<{ state: string }>((_resolve, reject) => {
        rejectRead = reject;
      }),
  );
  const failed = expect(
    waitForComputerStartup({ state: "booting" }, poll, { timeoutMs: 1500 }),
  ).rejects.toThrow("longer than expected");
  await vi.advanceTimersByTimeAsync(1500);
  await failed;
  rejectRead(new Error("late network error"));
  await vi.advanceTimersByTimeAsync(0);
  expect(poll).toHaveBeenCalledOnce();
});
