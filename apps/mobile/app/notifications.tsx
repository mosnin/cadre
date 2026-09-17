import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from "../components/settings-list";
import { currentApiBase, loadSessionToken, selectedSpaceId } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import {
  canPostPromotedNotifications,
  DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  getLiveNotificationSettings,
  type LiveNotificationSettings,
  openLiveNotificationSettings,
  openPromotedNotificationSettings,
  setLiveNotificationSettings,
} from "../lib/live-notifications";
import { native, useThemedStyles } from "../lib/native";
import { registerPushToken } from "../lib/push";

export default function Notifications() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const [settings, setSettings] = useState<LiveNotificationSettings>(
    DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  );
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getLiveNotificationSettings()
      .then(setSettings)
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  async function update(next: LiveNotificationSettings) {
    const previous = settings;
    setSettings(next);
    setPending(true);
    setError(null);
    try {
      await setLiveNotificationSettings(
        next,
        currentApiBase(),
        await loadSessionToken(),
        selectedSpaceId() ?? "",
      );
      if (next.liveConnection && !(await canPostPromotedNotifications())) {
        await openPromotedNotificationSettings();
      }
      await registerPushToken();
    } catch (cause) {
      setSettings(previous);
      setError(cause instanceof Error ? cause.message : t("Could not update notifications"));
    } finally {
      setPending(false);
    }
  }

  const disabled = pending || !ready;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsGroup>
          <SettingsSwitchRow
            title={t("Live working status")}
            detail={t("While agents are working")}
            value={settings.liveConnection}
            disabled={disabled}
            onChange={(liveConnection) => void update({ ...settings, liveConnection })}
          />
          <SettingsSwitchRow
            title={t("Agent messages")}
            detail={t("Replies and completed work")}
            value={settings.messages}
            disabled={disabled}
            onChange={(messages) => void update({ ...settings, messages })}
          />
          <SettingsSwitchRow
            title={t("Scheduled tasks")}
            detail={t("Alerts from routines")}
            value={settings.scheduledTasks}
            disabled={disabled}
            onChange={(scheduledTasks) => void update({ ...settings, scheduledTasks })}
          />
          <SettingsSwitchRow
            title={t("Needs attention")}
            detail={t("Questions, approvals, takeover")}
            value={settings.needsAttention}
            disabled={disabled}
            onChange={(needsAttention) => void update({ ...settings, needsAttention })}
          />
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            title={t("Live update settings")}
            onPress={() => void openPromotedNotificationSettings()}
          />
          <SettingsRow
            title={t("Notification settings")}
            onPress={() => void openLiveNotificationSettings()}
          />
        </SettingsGroup>
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
