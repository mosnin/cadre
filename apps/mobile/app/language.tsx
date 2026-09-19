import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow } from "../components/settings-list";
import { type MobileMe, rpc } from "../lib/api";
import { followDeviceUiLocale, setUiLocale, useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { normalizeUiLocale, UI_LOCALE_LABELS, UI_LOCALES, type UiLocale } from "../lib/ui-locale";

export default function Language() {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const [current, setCurrent] = useState<UiLocale | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void rpc<MobileMe>("me")
      .then((me) => setCurrent(me.locale ? normalizeUiLocale(me.locale) : null))
      .catch(() => undefined);
  }, []);

  async function choose(locale: UiLocale | null) {
    if (saving) return;
    setSaving(true);
    try {
      await rpc<MobileMe>("preferences/update", { locale });
      if (locale) await setUiLocale(locale);
      else await followDeviceUiLocale();
      setCurrent(locale);
      router.back();
    } catch (cause) {
      setSaving(false);
      Alert.alert(
        t("Could not change language"),
        cause instanceof Error ? cause.message : t("Try again."),
      );
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsGroup>
          <SettingsRow
            title={t("System")}
            checked={current === null}
            chevron={false}
            disabled={saving || current === undefined}
            onPress={() => void choose(null)}
          />
          {UI_LOCALES.map((code) => (
            <SettingsRow
              key={code}
              title={UI_LOCALE_LABELS[code]}
              checked={current === code}
              chevron={false}
              disabled={saving || current === undefined}
              onPress={() => void choose(code)}
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
