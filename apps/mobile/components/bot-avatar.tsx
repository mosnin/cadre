import { ACTIVE_RUN_STATUSES, orbGradientStops } from "@cadre/core";
import { memo } from "react";
import { View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { useI18n } from "../lib/i18n";
import { NativeSymbol } from "./native-symbol";

/**
 * An agent, drawn. There is one way to draw one — the orb, in the agent's own
 * colour. No shader here, so it is the same three stops the web orb derives,
 * still: a colour chosen on the web reads the same on a phone.
 */
export const BotAvatar = memo(function BotAvatar({
  color,
  size = 54,
  status,
  muted = false,
}: {
  color: string;
  size?: number;
  status?: string;
  /** Accepted and unused; the orb's whole appearance comes from the colour. */
  identity?: string;
  muted?: boolean;
}) {
  const { t } = useI18n();
  const isWorking = ACTIVE_RUN_STATUSES.some((activeStatus) => activeStatus === status);
  const [light, mid, dark] = orbGradientStops(color);
  const gradientId = `orb-${color.replace(/[^0-9a-zA-Z]/g, "")}`;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={gradientId} cx="38%" cy="32%" r="78%">
            <Stop offset="0%" stopColor={light} />
            <Stop offset="52%" stopColor={mid} />
            <Stop offset="100%" stopColor={dark} />
          </RadialGradient>
        </Defs>
        <Path d="M50 2a48 48 0 1 0 0 96 48 48 0 0 0 0-96Z" fill={`url(#${gradientId})`} />
      </Svg>
      {isWorking ? (
        <View
          accessibilityLabel={t("Working")}
          style={{
            position: "absolute",
            right: muted ? undefined : 0,
            left: muted ? 0 : undefined,
            bottom: 0,
            width: Math.max(6, Math.round(size * 0.18)),
            height: Math.max(6, Math.round(size * 0.18)),
            borderRadius: size,
            backgroundColor: "#F5A03C",
          }}
        />
      ) : null}
      {muted ? (
        <View
          accessible
          accessibilityLabel={t("Notifications silenced")}
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: Math.max(14, Math.round(size * 0.34)),
            height: Math.max(14, Math.round(size * 0.34)),
            borderRadius: size,
            borderWidth: 2,
            borderColor: "#000",
            backgroundColor: "#242428",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <NativeSymbol
            ios="bell.slash.fill"
            android="notifications-off"
            size={Math.max(8, Math.round(size * 0.17))}
            color="#ECECEE"
          />
        </View>
      ) : null}
    </View>
  );
});
