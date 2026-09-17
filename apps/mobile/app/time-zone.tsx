import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { SettingsRow } from "../components/settings-list";
import { type MobileMe, rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import {
  listTimeZones,
  searchTimeZones,
  timeZoneCity,
  timeZoneOffsetLabel,
  timeZoneRegion,
} from "../lib/time-zones";

export default function TimeZone() {
  const { t } = useI18n();
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useThemedStyles(createStyles);
  const [current, setCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void rpc<MobileMe>("me")
      .then((me) => setCurrent(me.timezone))
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

  const zones = useMemo(() => listTimeZones([current]), [current]);
  const results = useMemo(() => searchTimeZones(zones, query), [zones, query]);

  async function choose(zone: string) {
    if (saving) return;
    setSaving(true);
    try {
      await rpc<MobileMe>("preferences/update", { timezone: zone, timezoneAutomatic: false });
      setCurrent(zone);
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
      keyExtractor={(zone) => zone}
      keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <SettingsRow
          title={timeZoneCity(item)}
          detail={timeZoneRegion(item) || undefined}
          value={timeZoneOffsetLabel(item)}
          checked={item === current}
          chevron={false}
          disabled={saving}
          onPress={() => void choose(item)}
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
