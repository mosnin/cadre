import { describe, expect, it } from "vitest";
import { GROUP_AVATAR_RING, groupAvatarLayout } from "./group-avatar-layout.js";

describe("groupAvatarLayout", () => {
  it("keeps a single member at the full size", () => {
    const layout = groupAvatarLayout(54, 1);
    expect(layout).toMatchObject({
      miniSize: 54,
      slot: 54,
      visibleCount: 1,
      showOverflow: false,
      overflowLabel: null,
    });
  });

  it("fits a pair inside the slot without a stretched cluster ring", () => {
    const layout = groupAvatarLayout(54, 2);
    expect(layout.slot).toBeLessThanOrEqual(54);
    expect(layout.slot).toBeGreaterThan(layout.miniSize);
    expect(layout.slot - layout.miniSize).toBe(GROUP_AVATAR_RING * 2);
    expect(layout.visibleCount).toBe(2);
    expect(layout.positions).toEqual([
      { top: 0, left: 0 },
      { right: 0, bottom: 0 },
    ]);
  });

  it("centers the lead orb when three members share the slot", () => {
    const layout = groupAvatarLayout(54, 3);
    expect(layout.visibleCount).toBe(3);
    expect(layout.positions[0]).toEqual({
      top: 0,
      left: Math.round((54 - layout.slot) / 2),
    });
  });

  it("shows an overflow count instead of a fourth orb", () => {
    const layout = groupAvatarLayout(54, 5);
    expect(layout.visibleCount).toBe(2);
    expect(layout.showOverflow).toBe(true);
    expect(layout.overflowLabel).toBe("+3");
  });
});
