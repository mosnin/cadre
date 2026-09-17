import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow } from "../components/settings-list";
import { deleteAccount, type MobileBot, type MobileMe, rpc, signOut } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { explicitSignInRoute } from "../lib/auth-routing";
import { confirmDeleteBot } from "../lib/bot-lifecycle";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

export default function AccountDetails() {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const [me, setMe] = useState<MobileMe | null>(null);
  const [archivedBots, setArchivedBots] = useState<MobileBot[]>([]);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rpc<MobileMe>("me")
      .then(setMe)
      .catch(() => undefined);
    void rpc<MobileBot[]>("bots/listArchived")
      .then(setArchivedBots)
      .catch(() => undefined);
  }, []);

  async function restoreBot(botId: string) {
    try {
      await rpc("bots/restore", { botId });
      setArchivedBots((bots) => bots.filter((bot) => bot.id !== botId));
    } catch (restoreError) {
      Alert.alert(
        t("Could not restore bot"),
        restoreError instanceof Error ? restoreError.message : t("Try again."),
      );
    }
  }

  async function handleSignOut() {
    setPending(true);
    setError(null);
    try {
      await signOut();
      router.dismissAll();
      router.replace(explicitSignInRoute);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not sign out"));
      setPending(false);
    }
  }

  function confirmDeletion() {
    setError(null);
    Alert.alert(
      t("Delete your account?"),
      t(
        "This permanently deletes your account, bots, conversations, memories, files, and saved connections. This cannot be undone.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete account"),
          style: "destructive",
          onPress: () => void handleDeletion(),
        },
      ],
    );
  }

  async function handleDeletion() {
    setPending(true);
    setError(null);
    try {
      await deleteAccount(password);
      router.dismissAll();
      router.replace("/sign-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not delete account"));
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <Text style={styles.name}>{me?.name || t("Your account")}</Text>
          {me?.email ? <Text style={styles.email}>{me.email}</Text> : null}
        </View>

        <SettingsGroup>
          <SettingsRow
            title={t("Change password")}
            disabled={pending}
            onPress={() => router.push("/change-password")}
          />
          <SettingsRow
            title={t("Sign out")}
            chevron={false}
            disabled={pending}
            onPress={() => void handleSignOut()}
          />
        </SettingsGroup>

        {archivedBots.length > 0 ? (
          <SettingsGroup title={t("Archived bots")}>
            {archivedBots.map((bot) => (
              <SettingsRow
                key={bot.id}
                title={bot.name}
                trailing={
                  <View style={styles.archivedActions}>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => void restoreBot(bot.id)}
                    >
                      <Text style={styles.restoreLabel}>{t("Restore")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() =>
                        confirmDeleteBot(bot, () =>
                          setArchivedBots((bots) => bots.filter((item) => item.id !== bot.id)),
                        )
                      }
                    >
                      <Text style={styles.archivedDeleteLabel}>{t("Delete")}</Text>
                    </Pressable>
                  </View>
                }
              />
            ))}
          </SettingsGroup>
        ) : null}

        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>{t("Delete account")}</Text>
          <Text style={styles.explanation}>
            {t(
              "Enter your current password, then confirm permanent deletion of your account and all associated data.",
            )}
          </Text>
          <TextInput
            accessibilityLabel={t("Current password")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
            onChangeText={(value) => {
              setPassword(value);
              setError(null);
            }}
            placeholder={t("Current password")}
            placeholderTextColor={native.tertiaryLabel}
            secureTextEntry
            style={styles.password}
            textContentType="password"
            value={password}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={pending || !password}
            onPress={confirmDeletion}
            style={({ pressed }) => [
              styles.deleteButton,
              (pending || !password) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {pending ? (
              <ActivityIndicator color={mobileTokens().destructiveForeground} />
            ) : (
              <Text style={styles.deleteLabel}>{t("Delete account")}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
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
    profile: {
      alignItems: "center",
      gap: 4,
      paddingVertical: 8,
    },
    name: {
      color: native.label,
      fontSize: 22,
      fontWeight: "600",
    },
    email: {
      color: native.secondaryLabel,
      fontSize: 15,
    },
    archivedActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    restoreLabel: {
      color: native.label,
      fontSize: 15,
      fontWeight: "600",
    },
    archivedDeleteLabel: {
      color: tokens.destructive,
      fontSize: 15,
    },
    dangerZone: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.destructive,
      padding: 18,
    },
    dangerTitle: {
      color: tokens.destructive,
      fontSize: 17,
      fontWeight: "600",
    },
    explanation: {
      color: native.secondaryLabel,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 8,
    },
    password: {
      height: 48,
      borderRadius: 12,
      backgroundColor: native.fill,
      color: native.label,
      paddingHorizontal: 14,
      marginTop: 16,
      fontSize: 16,
    },
    error: {
      color: tokens.destructive,
      fontSize: 14,
      marginTop: 10,
    },
    deleteButton: {
      minHeight: 50,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.destructive,
      marginTop: 14,
    },
    deleteLabel: {
      color: tokens.destructiveForeground,
      fontSize: 16,
      fontWeight: "700",
    },
    disabled: {
      opacity: 0.45,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
