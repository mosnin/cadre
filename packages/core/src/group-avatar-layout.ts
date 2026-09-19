import { LIVE_ORB_MIN_SIZE } from "./group-member-orbs.js";

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
  const raw = Math.round(size * (pair ? 0.6 : 0.5));
  const miniSize =
    size < LIVE_ORB_MIN_SIZE ? raw : Math.max(raw, Math.min(size, LIVE_ORB_MIN_SIZE));
  const slot = Math.min(size, miniSize + GROUP_AVATAR_RING * 2);
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
