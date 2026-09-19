import { describe, expect, it } from "vitest";
import { routineClockSource, routineNumberFlowDelayMs, routineRunClock } from "./routine-run-clock";

describe("routine run clock", () => {
  it("reads hour and minute from an ISO instant", () => {
    const clock = routineRunClock("2026-09-20T13:05:00");
    expect(clock).toEqual({
      hour: new Date("2026-09-20T13:05:00").getHours(),
      minute: 5,
    });
  });

  it("prefers the next run over the last one", () => {
    expect(
      routineClockSource({
        nextRunAt: "2026-09-21T09:00:00.000Z",
        lastRunAt: "2026-09-20T09:00:00.000Z",
      }),
    ).toBe("2026-09-21T09:00:00.000Z");
  });

  it("staggers only the first few visible rows", () => {
    expect(routineNumberFlowDelayMs(0)).toBe(0);
    expect(routineNumberFlowDelayMs(3)).toBe(240);
    expect(routineNumberFlowDelayMs(20)).toBe(560);
  });
});
