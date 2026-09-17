import { describe, expect, it } from "vitest";
import { CreateRoutineInput, RoutineTimezone, SaveSiteLoginInput } from "./domain.js";

describe("routine time zones", () => {
  it("rejects unknown zones instead of silently using UTC", () => {
    expect(RoutineTimezone.safeParse("America/New York").success).toBe(false);
    expect(RoutineTimezone.safeParse("Mars/Olympus").success).toBe(false);
    expect(RoutineTimezone.parse(" Europe/Berlin ")).toBe("Europe/Berlin");
    const parsed = CreateRoutineInput.safeParse({
      botId: "bot_1",
      name: "Daily",
      prompt: "go",
      crons: ["0 9 * * *"],
      timezone: "Nowhere/Land",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("saved logins", () => {
  it("normalizes hosts and rejects URLs", () => {
    expect(
      SaveSiteLoginInput.parse({ host: " Example.COM ", username: "me", password: "x" }),
    ).toEqual({
      host: "example.com",
      username: "me",
      password: "x",
    });
    expect(
      SaveSiteLoginInput.safeParse({
        host: "https://example.com/login",
        username: "me",
        password: "x",
      }).success,
    ).toBe(false);
    expect(
      SaveSiteLoginInput.safeParse({ host: "example.com", username: "", password: "x" }).success,
    ).toBe(false);
  });
});
