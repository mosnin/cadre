import type { AgentSkillCatalogEntry, CapabilityInstall } from "@cadre/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from "../components/settings-list";
import {
  type CompanyWorkspaces,
  listCompanyWorkspaces,
  type MobileBot,
  type MobileMe,
  rpc,
} from "../lib/api";
import { getCachedAppearancePreference } from "../lib/appearance";
import { dateLocaleForUi, useI18n } from "../lib/i18n";
import { loadLastBotId } from "../lib/last-bot";
import { native, useThemedStyles } from "../lib/native";
import { regionName } from "../lib/regions";
import { automaticTimeZonePatch, deviceTimeZone } from "../lib/time-zones";
import { normalizeUiLocale, UI_LOCALE_LABELS } from "../lib/ui-locale";

type AutoReview = { enabled: boolean; checkerAvailable: boolean };
type Usage = { runs: number; inputTokens: number; outputTokens: number };

export default function Settings() {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const mounted = useRef(false);
  const [me, setMe] = useState<MobileMe | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [autoReview, setAutoReview] = useState<AutoReview | null>(null);
  const [installed, setInstalled] = useState<number | null>(null);
  const [company, setCompany] = useState<CompanyWorkspaces | null>(null);
  const [computerBot, setComputerBot] = useState<MobileBot | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const appearance = getCachedAppearancePreference();

  const refresh = useCallback(async () => {
    const settle = <T,>(promise: Promise<T>, apply: (value: T) => void) =>
      promise.then((value) => mounted.current && apply(value)).catch(() => undefined);
    await Promise.all([
      settle(rpc<MobileMe>("me"), (next) => {
        setMe(next);
        const patch = automaticTimeZonePatch(next, deviceTimeZone());
        if (patch) {
          void rpc<MobileMe>("preferences/update", patch)
            .then((synced) => mounted.current && setMe(synced))
            .catch(() => undefined);
        }
      }),
      settle(rpc<Usage>("usage/summary"), setUsage),
      settle(rpc<AutoReview>("autoReview/get"), setAutoReview),
      settle(
        Promise.all([
          rpc<CapabilityInstall[]>("capabilities/list"),
          rpc<AgentSkillCatalogEntry[]>("agentSkills/list"),
        ]),
        ([capabilities, skills]) => setInstalled(capabilities.length + skills.length),
      ),
      settle(listCompanyWorkspaces(), setCompany),
      settle(Promise.all([rpc<MobileBot[]>("bots/list"), loadLastBotId()]), ([bots, lastBotId]) =>
        setComputerBot(bots.find((bot) => bot.id === lastBotId) ?? bots[0] ?? null),
      ),
    ]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void refresh();
      return () => {
        mounted.current = false;
      };
    }, [refresh]),
  );

  async function updatePreferences(patch: {
    timezone?: string | null;
    timezoneAutomatic?: boolean;
  }) {
    setSavingPreferences(true);
    try {
      setMe(await rpc<MobileMe>("preferences/update", patch));
    } catch (cause) {
      Alert.alert(
        t("Could not save changes"),
        cause instanceof Error ? cause.message : t("Try again."),
      );
    } finally {
      if (mounted.current) setSavingPreferences(false);
    }
  }

  async function setAutoReviewEnabled(enabled: boolean) {
    const previous = autoReview;
    setAutoReview((current) => (current ? { ...current, enabled } : current));
    try {
      setAutoReview(await rpc<AutoReview>("autoReview/set", { enabled }));
    } catch (cause) {
      setAutoReview(previous);
      Alert.alert(
        t("Could not save changes"),
        cause instanceof Error ? cause.message : t("Try again."),
      );
    }
  }

  const connectedCompany = company?.connections.find((connection) => connection.connected);
  const timezoneAutomatic = me?.timezoneAutomatic ?? true;
  const timeZoneValue = me?.timezone ?? (timezoneAutomatic ? deviceTimeZone() : null);
  const appearanceLabel =
    appearance === "light" ? t("Light") : appearance === "dark" ? t("Dark") : t("System");

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsGroup>
          <SettingsRow
            title={me?.name || t("Your account")}
            detail={me?.email}
            onPress={() => router.push("/account-details")}
          />
          <SettingsRow
            title={t("Usage")}
            value={
              usage
                ? t("{runs} runs · {tokens} tokens", {
                    runs: usage.runs,
                    tokens: usage.inputTokens + usage.outputTokens,
                  })
                : null
            }
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            title={t("Plugins")}
            value={installed === null ? null : String(installed)}
            onPress={() => router.push("/plugins")}
          />
        </SettingsGroup>

        <SettingsGroup title={t("Bot")}>
          <SettingsSwitchRow
            title={t("Auto-review")}
            value={autoReview?.enabled ?? false}
            disabled={!autoReview?.checkerAvailable}
            onChange={(enabled) => void setAutoReviewEnabled(enabled)}
          />
          <SettingsSwitchRow
            title={t("Set time zone automatically")}
            value={timezoneAutomatic}
            disabled={!me || savingPreferences}
            onChange={(automatic) =>
              void updatePreferences(
                automatic
                  ? { timezoneAutomatic: true, timezone: deviceTimeZone() ?? me?.timezone ?? null }
                  : { timezoneAutomatic: false },
              )
            }
          />
          <SettingsRow
            title={t("Time zone")}
            value={timeZoneValue}
            disabled={!me || timezoneAutomatic}
            onPress={() => router.push("/time-zone")}
          />
          <SettingsRow
            title={t("Bot computer")}
            value={computerBot?.name ?? null}
            disabled={!computerBot}
            onPress={() =>
              computerBot &&
              router.push({
                pathname: "/computer",
                params: { botId: computerBot.id, name: computerBot.name },
              })
            }
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            title={t("Company OS")}
            value={connectedCompany?.companyName ?? t("Not connected")}
            onPress={() => router.push("/company-os")}
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow title={t("Connections")} onPress={() => router.push("/connections")} />
        </SettingsGroup>

        <SettingsGroup>
          {Platform.OS === "android" ? (
            <SettingsRow title={t("Notifications")} onPress={() => router.push("/notifications")} />
          ) : null}
          <SettingsRow
            title={t("Appearance")}
            value={appearanceLabel}
            onPress={() => router.push("/appearance")}
          />
          <SettingsRow
            title={t("Language")}
            value={
              me ? (me.locale ? UI_LOCALE_LABELS[normalizeUiLocale(me.locale)] : t("System")) : null
            }
            onPress={() => router.push("/language")}
          />
          <SettingsRow
            title={t("Region")}
            value={
              me ? (me.region ? regionName(me.region, dateLocaleForUi()) : t("Automatic")) : null
            }
            onPress={() => router.push("/region")}
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow title={t("Models")} onPress={() => router.push("/models")} />
          <SettingsRow title={t("Voice")} onPress={() => router.push("/voice")} />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: native.page,
    },
    content: {
      flexGrow: 1,
      padding: 20,
      gap: 24,
    },
  });
}
