import { formatMessageDayLabel } from "@cadre/core";
import { Text } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { dateLocaleForUi, useI18n } from "../lib/i18n";

export function MessageDayStamp({ createdAt, nowMs }: { createdAt: string; nowMs?: number }) {
  const { locale } = useI18n();
  const tokens = mobileTokens();
  return (
    <Text
      accessibilityRole="text"
      style={{
        alignSelf: "center",
        marginTop: 16,
        marginBottom: 8,
        color: tokens.mutedForeground,
        fontSize: 12,
        textAlign: "center",
      }}
    >
      {formatMessageDayLabel(createdAt, nowMs ?? Date.now(), dateLocaleForUi(locale))}
    </Text>
  );
}
