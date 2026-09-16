import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow } from "../components/settings-list";
import {
  connectWorkspaceIntegration,
  disconnectWorkspaceIntegration,
  listWorkspaceIntegrations,
  type WorkspaceIntegrationProvider,
  type WorkspaceIntegrations,
} from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

export default function Connections() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const mounted = useRef(false);
  const [integrations, setIntegrations] = useState<WorkspaceIntegrations | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listWorkspaceIntegrations();
      if (mounted.current) setIntegrations(next);
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

  async function run(provider: string, action: () => Promise<void>) {
    setPending(provider);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : t("Could not connect"));
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  function press(provider: WorkspaceIntegrationProvider, connectedName: string | null) {
    if (!connectedName) {
      void run(provider.id, async () => {
        const { url } = await connectWorkspaceIntegration(provider.id);
        await Linking.openURL(url);
      });
      return;
    }
    Alert.alert(t("Disconnect {name}?", { name: connectedName }), undefined, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Disconnect"),
        style: "destructive",
        onPress: () =>
          void run(provider.id, async () => {
            await disconnectWorkspaceIntegration(provider.id);
            await refresh();
          }),
      },
    ]);
  }

  const available = integrations?.available ?? false;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {integrations ? (
          <SettingsGroup footer={available ? undefined : t("Not available on this server")}>
            {integrations.providers.map((provider) => {
              const connection = integrations.connections.find(
                (row) => row.provider === provider.id && row.connected,
              );
              return (
                <SettingsRow
                  key={provider.id}
                  title={provider.name}
                  value={connection?.externalName ?? t("Not connected")}
                  chevron={false}
                  disabled={!available || pending !== null}
                  onPress={() => press(provider, connection?.externalName ?? null)}
                />
              );
            })}
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
