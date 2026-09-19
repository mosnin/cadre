import { memo } from "react";
import { OrbAvatar, type OrbState } from "./orb-avatar.js";
import "./styles.css";

export interface BotAvatarProps {
  /** The agent's colour. Every stop the orb draws comes from it. */
  color: string;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
}

/**
 * An agent, drawn. There is one way to draw one — the orb, in the agent's own
 * colour — so this is the orb plus the translation from a run status into the
 * orb's own language.
 *
 * `identity` is accepted and unused: the orb takes its whole appearance from
 * the colour, and callers pass the id because the shapes that came before it
 * were generated from one.
 */
export const BotAvatar = memo(function BotAvatar({
  color,
  size = 38,
  status,
  className,
}: BotAvatarProps) {
  return (
    <OrbAvatar color={color} size={size} state={orbStateForStatus(status)} className={className} />
  );
});

/**
 * A run in flight is the orb speaking, one waiting on an answer is it
 * listening, one starting up is it connecting, and anything else is at rest.
 */
function orbStateForStatus(status: string | undefined): OrbState {
  if (status === "waiting_input") return "listening";
  if (status === "queued" || status === "leased") return "connecting";
  if (status === "running" || status === "waiting_takeover") return "speaking";
  return "idle";
}
