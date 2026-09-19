import { groupAvatarLayout } from "@cadre/core";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { native, useThemedStyles } from "../lib/native";
import { BotAvatar } from "./bot-avatar";

export interface GroupAvatarMember {
  botId?: string;
  name?: string;
  color: string;
  status?: string;
}

export const GroupAvatar = memo(function GroupAvatar({
  members,
  size = 54,
}: {
  members: GroupAvatarMember[];
  size?: number;
}) {
  const styles = useThemedStyles(createGroupAvatarStyles);
  const firstMember = members[0];
  if (!firstMember) {
    return (
      <View
        style={[
          styles.fallback,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.35) }]}>👥</Text>
      </View>
    );
  }

  if (members.length === 1) {
    return (
      <BotAvatar
        color={firstMember.color}
        identity={firstMember.botId ?? firstMember.name}
        size={size}
        status={firstMember.status}
      />
    );
  }

  const layout = groupAvatarLayout(size, members.length);
  const visibleMembers = members.slice(0, layout.visibleCount);

  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {visibleMembers.map((member, index) => (
        <View
          key={member.botId ?? index}
          style={{
            position: "absolute",
            width: layout.slot,
            height: layout.slot,
            borderRadius: layout.slot / 2,
            backgroundColor: native.page,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            zIndex: index + 1,
            ...layout.positions[index],
          }}
        >
          <BotAvatar
            color={member.color}
            identity={member.botId ?? member.name}
            size={layout.miniSize}
            status={member.status}
          />
        </View>
      ))}
      {layout.showOverflow && layout.overflowLabel ? (
        <View
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            zIndex: 3,
            width: layout.slot,
            height: layout.slot,
            borderRadius: layout.slot / 2,
            backgroundColor: native.fillPressed,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <Text style={{ color: native.label, fontSize: 10, fontWeight: "600" }}>
            {layout.overflowLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

function createGroupAvatarStyles() {
  return StyleSheet.create({
    fallback: {
      backgroundColor: native.fillPressed,
      alignItems: "center",
      justifyContent: "center",
    },
    fallbackText: {
      color: native.secondaryLabel,
    },
  });
}
