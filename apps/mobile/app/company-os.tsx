import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow } from "../components/settings-list";
import {
  type CompanyWorkspaces,
  connectCompanyWorkspace,
  disconnectCompanyWorkspace,
  listCompanyWorkspaces,
} from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

export default function CompanyOs() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const mounted = useRef(false);
  const [workspaces, setWorkspaces] = useState<CompanyWorkspaces | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listCompanyWorkspaces();
      if (mounted.current) setWorkspaces(next);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : t("Could not load connections"));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void refresh();
      return () => {
        mounted.current = false;
      };
    }, [refresh]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : t("Could not connect"));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  function connect() {
    void run(async () => {
      const { url } = await connectCompanyWorkspace();
      await Linking.openURL(url);
    });
  }

  function confirmDisconnect(name: string) {
    Alert.alert(t("Disconnect {name}?", { name }), undefined, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Disconnect"),
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await disconnectCompanyWorkspace();
            await refresh();
          }),
      },
    ]);
  }

  const connected = workspaces?.connections.filter((connection) => connection.connected) ?? [];
  const available = workspaces?.available ?? false;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {connected.length > 0 ? (
          <SettingsGroup title={t("Connected")}>
            {connected.map((connection) => (
              <SettingsRow
                key={connection.spaceId}
                title={connection.companyName}
                detail={connection.companySlug}
                value={t("Disconnect")}
                chevron={false}
                disabled={pending}
                onPress={() => confirmDisconnect(connection.companyName)}
              />
            ))}
          </SettingsGroup>
        ) : null}
        {workspaces ? (
          <SettingsGroup footer={available ? undefined : t("Not available on this server")}>
            <SettingsRow
              title={connected.length > 0 ? t("Connect another company") : t("Connect")}
              chevron={false}
              disabled={pending || !available}
              onPress={connect}
            />
          </SettingsGroup>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { flexGrow: 1, padding: 20, gap: 24 },
    error: { color: tokens.destructive, fontSize: 14, paddingHorizontal: 16 },
  });
}
