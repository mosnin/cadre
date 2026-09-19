export type GroupAvatarSlot = {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
};

export type GroupAvatarLayout = {
  miniSize: number;
  slot: number;
  visibleCount: number;
  showOverflow: boolean;
  overflowLabel: string | null;
  positions: GroupAvatarSlot[];
};

/** Page-coloured halo so overlapping orbs cut each other out, not outline the cluster. */
export const GROUP_AVATAR_RING = 2;

/** Minimum offset between stacked orbs so a pair reads as two, not one sliver. */
export const GROUP_STACK_TRAVEL = 10;

export function groupAvatarLayout(size: number, memberCount: number): GroupAvatarLayout {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Group avatar size must be a positive number");
  }
  if (!Number.isInteger(memberCount) || memberCount < 0) {
    throw new Error("Group avatar member count must be a non-negative integer");
  }

  if (memberCount <= 1) {
    return {
      miniSize: size,
      slot: size,
      visibleCount: memberCount,
      showOverflow: false,
      overflowLabel: null,
      positions: [{ top: 0, left: 0 }],
    };
  }

  const pair = memberCount === 2;
  const visibleCount = pair || memberCount === 3 ? memberCount : 2;
  const showOverflow = memberCount > 3;
  let miniSize = Math.round(size * (pair ? 0.6 : 0.5));
  let slot = Math.min(size, miniSize + GROUP_AVATAR_RING * 2);
  const maxSlot = size - GROUP_STACK_TRAVEL;
  if (size >= 28 && slot > maxSlot) {
    miniSize = Math.max(Math.round(size * 0.45), maxSlot - GROUP_AVATAR_RING * 2);
    slot = Math.min(size, miniSize + GROUP_AVATAR_RING * 2);
  }
  const centered = Math.round((size - slot) / 2);
  const positions: GroupAvatarSlot[] = pair
    ? [
        { top: 0, left: 0 },
        { right: 0, bottom: 0 },
      ]
    : [
        { top: 0, left: centered },
        { bottom: 0, left: 0 },
        { right: 0, bottom: 0 },
      ];

  return {
    miniSize,
    slot,
    visibleCount,
    showOverflow,
    overflowLabel: showOverflow ? `+${memberCount - 2}` : null,
    positions,
  };
}
