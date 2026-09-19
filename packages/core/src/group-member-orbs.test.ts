import { describe, expect, it } from "vitest";
import { groupAvatarMiniSize, LIVE_ORB_MIN_SIZE, paintGroupMembers } from "./group-member-orbs.js";

describe("paintGroupMembers", () => {
  it("replaces a stale member colour with the live bot roster", () => {
    expect(
      paintGroupMembers(
        [{ botId: "alfred", color: "#E9973F", status: "idle" }],
        [{ id: "alfred", color: "#26BF8C", status: "running" }],
      ),
    ).toEqual([{ botId: "alfred", color: "#26BF8C", status: "running" }]);
  });

  it("leaves a member alone when the roster has no match", () => {
    const members = [{ botId: "missing", color: "#3380FF" }];
    expect(paintGroupMembers(members, [])).toEqual(members);
  });
});

describe("groupAvatarMiniSize", () => {
  it("keeps a rail pair large enough for the official orb", () => {
    expect(groupAvatarMiniSize(28, 2)).toBe(LIVE_ORB_MIN_SIZE);
    expect(groupAvatarMiniSize(28, 2)).toBeGreaterThanOrEqual(20);
  });

  it("does not enlarge mention-sized stacks", () => {
    expect(groupAvatarMiniSize(16, 2)).toBe(Math.round(16 * 0.65));
  });
});
