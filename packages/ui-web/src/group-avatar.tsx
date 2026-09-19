import { groupAvatarLayout } from "@cadre/core";
import { type CSSProperties, memo } from "react";
import { BotAvatar } from "./bot-avatar.js";
import { cn } from "./lib/utils.js";

export interface GroupAvatarMember {
  botId?: string;
  name?: string;
  color: string;
  status?: string;
}

export interface GroupAvatarProps {
  members: GroupAvatarMember[];
  size?: number;
  className?: string;
}

export const GroupAvatar = memo(function GroupAvatar({
  members,
  size = 38,
  className,
}: GroupAvatarProps) {
  const firstMember = members[0];
  if (!firstMember) {
    return (
      <div
        className={cn(
          "cadre-group-avatar relative flex items-center justify-center rounded-full border border-border bg-muted text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size, flex: "none" }}
      >
        <svg
          aria-hidden="true"
          width={Math.round(size * 0.48)}
          height={Math.round(size * 0.48)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
    );
  }

  if (members.length === 1) {
    return (
      <BotAvatar
        color={firstMember.color}
        identity={firstMember.botId ?? firstMember.name}
        size={size}
        status={firstMember.status}
        className={cn("cadre-group-avatar", className)}
      />
    );
  }

  const layout = groupAvatarLayout(size, members.length);
  const visibleMembers = members.slice(0, layout.visibleCount);

  return (
    <div
      className={cn("cadre-group-avatar relative select-none", className)}
      style={{ width: size, height: size, flex: "none" }}
    >
      {visibleMembers.map((member, index) => (
        <div
          key={member.botId ?? index}
          className="absolute flex items-center justify-center overflow-hidden rounded-full bg-background"
          style={
            {
              width: layout.slot,
              height: layout.slot,
              zIndex: index + 1,
              ...layout.positions[index],
            } as CSSProperties
          }
        >
          <BotAvatar
            color={member.color}
            identity={member.botId ?? member.name}
            size={layout.miniSize}
            status={member.status}
          />
        </div>
      ))}
      {layout.showOverflow && layout.overflowLabel ? (
        <div
          className="absolute right-0 bottom-0 z-[3] flex items-center justify-center overflow-hidden rounded-full bg-accent text-[10px] font-semibold text-foreground"
          style={{
            width: layout.slot,
            height: layout.slot,
          }}
        >
          {layout.overflowLabel}
        </div>
      ) : null}
    </div>
  );
});
