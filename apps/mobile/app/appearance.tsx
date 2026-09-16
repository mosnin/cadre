import type { AvatarStyle } from "@rakazo/contracts";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAvatarStyle } from "../components/avatar-style";
import { BotAvatar } from "../components/bot-avatar";
import { SettingsGroup, SettingsRow } from "../components/settings-list";
import {
  type AppearancePreference,
  getCachedAppearancePreference,
  setAppearancePreference,
} from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useResolvedAppearance, useThemedStyles } from "../lib/native";

export default function Appearance() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  useResolvedAppearance();
  const appearance = getCachedAppearancePreference();
  const { avatarStyle, updateAvatarStyle } = useAvatarStyle();
  const [avatarPending, setAvatarPending] = useState(false);

  async function selectAvatarStyle(next: AvatarStyle) {
    if (next === avatarStyle || avatarPending) return;
    setAvatarPending(true);
    try {
      await updateAvatarStyle(next);
    } catch {
      Alert.alert(t("Couldn't update avatars"));
    } finally {
      setAvatarPending(false);
    }
  }

  const appearances: Array<[AppearancePreference, string]> = [
    ["system", t("System")],
    ["light", t("Light")],
    ["dark", t("Dark")],
  ];
  const avatars: Array<[AvatarStyle, string, string]> = [
    ["robot", t("Robot"), "#8B5CF6"],
    ["organic", t("Organic"), "#D62F8B"],
  ];

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsGroup title={t("Appearance")}>
          {appearances.map(([value, label]) => (
            <SettingsRow
              key={value}
              title={label}
              checked={appearance === value}
              chevron={false}
              onPress={() => void setAppearancePreference(value)}
            />
          ))}
        </SettingsGroup>
        <SettingsGroup title={t("Avatars")}>
          {avatars.map(([value, label, color]) => (
            <SettingsRow
              key={value}
              accessibilityLabel={t("{style} avatars", { style: label })}
              title={label}
              checked={avatarStyle === value}
              chevron={false}
              disabled={avatarPending}
              leading={
                <BotAvatar color={color} identity="avatar-preview" size={32} variant={value} />
              }
              onPress={() => void selectAvatarStyle(value)}
            />
          ))}
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { flexGrow: 1, padding: 20, gap: 24 },
  });
}
