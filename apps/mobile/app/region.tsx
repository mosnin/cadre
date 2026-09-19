import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { SettingsRow } from "../components/settings-list";
import { type MobileMe, rpc } from "../lib/api";
import { dateLocaleForUi, useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { listRegions, type RegionOption, searchRegions } from "../lib/regions";

const AUTOMATIC = "";

export default function Region() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useThemedStyles(createStyles);
  const [current, setCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void rpc<MobileMe>("me")
      .then((me) => setCurrent(me.region))
      .catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: t("Search"),
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
    });
  }, [navigation, t]);

  const regions = useMemo(() => listRegions(dateLocaleForUi(locale), [current]), [locale, current]);
  const results = useMemo<RegionOption[]>(() => {
    const matches = searchRegions(regions, query);
    return query.trim() ? matches : [{ code: AUTOMATIC, name: t("Automatic") }, ...matches];
  }, [regions, query, t]);

  async function choose(code: string) {
    if (saving) return;
    setSaving(true);
    try {
      await rpc<MobileMe>("preferences/update", { region: code || null });
      setCurrent(code || null);
      router.back();
    } catch (cause) {
      setSaving(false);
      Alert.alert(
        t("Could not save changes"),
        cause instanceof Error ? cause.message : t("Try again."),
      );
    }
  }

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      data={results}
      keyExtractor={(region) => region.code || "automatic"}
      keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <SettingsRow
          title={item.name}
          checked={(current ?? AUTOMATIC) === item.code}
          chevron={false}
          disabled={saving}
          onPress={() => void choose(item.code)}
        />
      )}
      style={styles.list}
    />
  );
}

function createStyles() {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: native.page },
    content: { paddingVertical: 8 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: native.tertiaryLabel,
      marginLeft: 16,
    },
  });
}
