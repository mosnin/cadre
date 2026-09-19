/** Rail orbs run the official shader at this size; mentions stay a still fill. */
export const LIVE_ORB_MIN_SIZE = 20;

export type GroupMemberOrb = {
  botId?: string;
  color: string;
  status?: string;
};

export type BotOrbSource = {
  id: string;
  color: string;
  status?: string;
};

/**
 * Group lists can lag a colour change. Paint members from the live bot
 * roster so the rail does not keep a stale orb next to the real one.
 */
export function paintGroupMembers<M extends GroupMemberOrb>(
  members: readonly M[],
  bots: readonly BotOrbSource[],
): M[] {
  if (!Array.isArray(members) || !Array.isArray(bots)) {
    throw new Error("paintGroupMembers requires member and bot lists");
  }
  return members.map((member) => {
    const botId = member.botId;
    if (!botId) return member;
    const bot = bots.find((candidate) => candidate.id === botId);
    if (!bot) return member;
    return {
      ...member,
      color: bot.color,
      status: bot.status ?? member.status,
    };
  });
}

/** Keep stacked orbs large enough for the official shader on the rail. */
export function groupAvatarMiniSize(size: number, memberCount: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Group avatar size must be a positive number");
  }
  if (!Number.isInteger(memberCount) || memberCount < 0) {
    throw new Error("Group avatar member count must be a non-negative integer");
  }
  if (memberCount <= 1) return size;
  const raw = Math.round(size * (memberCount === 2 ? 0.65 : 0.54));
  if (size < LIVE_ORB_MIN_SIZE) return raw;
  return Math.max(raw, Math.min(size, LIVE_ORB_MIN_SIZE));
}
