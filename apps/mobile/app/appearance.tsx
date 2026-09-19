import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

  const appearances: Array<[AppearancePreference, string]> = [
    ["system", t("System")],
    ["light", t("Light")],
    ["dark", t("Dark")],
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
