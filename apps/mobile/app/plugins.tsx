import type { AgentSkillCatalogEntry, CapabilityInstall, Connection } from "@cadre/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow } from "../components/settings-list";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

export default function Plugins() {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const mounted = useRef(false);
  const [apps, setApps] = useState<number | null>(null);
  const [skills, setSkills] = useState<number | null>(null);
  const [bundles, setBundles] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void rpc<Connection[]>("connections/list")
        .then((rows) => mounted.current && setApps(rows.length))
        .catch(() => undefined);
      void rpc<AgentSkillCatalogEntry[]>("agentSkills/list")
        .then((rows) => mounted.current && setSkills(rows.length))
        .catch(() => undefined);
      void rpc<CapabilityInstall[]>("capabilities/list")
        .then(
          (rows) =>
            mounted.current && setBundles(rows.filter((row) => row.kind === "plugin").length),
        )
        .catch(() => undefined);
      return () => {
        mounted.current = false;
      };
    }, []),
  );

  const count = (value: number | null) => (value === null ? null : String(value));

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsGroup>
          <SettingsRow
            title={t("Apps")}
            value={count(apps)}
            onPress={() => router.push("/integrations")}
          />
          <SettingsRow
            title={t("Skills and workflows")}
            value={count(skills)}
            onPress={() => router.push("/library")}
          />
          <SettingsRow
            title={t("Plugin bundles")}
            value={count(bundles)}
            onPress={() => router.push("/library")}
          />
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
