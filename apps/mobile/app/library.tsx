import type { AgentSkill, AgentSkillCatalogEntry, CapabilityInstall } from "@cadre/contracts";
import { buildSkillMd, parseSkillMd, validatePluginBundle } from "@cadre/core";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function WorkspaceLibrary() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [skills, setSkills] = useState<AgentSkillCatalogEntry[]>([]);
  const [plugins, setPlugins] = useState<CapabilityInstall[]>([]);
  const [editor, setEditor] = useState<AgentSkill | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [copyOrigin, setCopyOrigin] = useState<Record<string, unknown> | undefined>();
  const [pendingPlugin, setPendingPlugin] = useState<{
    name: string;
    files: { path: string; content: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const [next, installs] = await Promise.all([
      rpc<AgentSkillCatalogEntry[]>("agentSkills/list"),
      rpc<CapabilityInstall[]>("capabilities/list"),
    ]);
    if (!mounted.current) return;
    setSkills(next);
    setPlugins(installs.filter((plugin) => plugin.kind === "plugin"));
    setLoading(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      setBusy(saving.current);
      void refresh().catch((cause) => {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : t("Could not load library"));
          setLoading(false);
        }
      });
      return () => {
        mounted.current = false;
      };
    }, [refresh, t]),
  );
  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : t("Could not save changes"));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refreshSaved() {
    try {
      await refresh();
    } catch {
      if (mounted.current) {
        setLoading(false);
        setError(t("Changes saved. Reload the library to see them."));
      }
    }
  }
  async function importFile() {
    await run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/markdown", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const file = new File(asset.uri);
      if (file.size > 40000000) throw new Error(t("Plugin bundle is too large"));
      const text = await file.text();
      if (asset.name.toLowerCase().endsWith(".json")) {
        const raw = JSON.parse(text);
        const bundle = validatePluginBundle(raw);
        setPendingPlugin({
          name:
            typeof raw.name === "string"
              ? raw.name.slice(0, 120)
              : asset.name.replace(/\.json$/i, ""),
          files: bundle.files,
        });
      } else {
        if (text.length > 100000) throw new Error(t("Skill files must be 100 KB or less"));
        await rpc("agentSkills/create", { content: text });
        await refreshSaved();
      }
    });
  }
  function remove(entry: AgentSkillCatalogEntry | CapabilityInstall) {
    Alert.alert(t("Remove from workspace?"), entry.name, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Remove"),
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await rpc(
              "kind" in entry ? "capabilities/remove" : "agentSkills/remove",
              "kind" in entry ? { id: entry.id } : { skillId: entry.id },
            );
            await refreshSaved();
          }),
      },
    ]);
  }
  function action(label: string, onPress: () => void, primary = false, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy || disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderRadius: 9999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: primary ? tokens.primary : tokens.muted,
          opacity: busy ? 0.5 : pressed ? 0.75 : 1,
        })}
      >
        <Text
          style={{
            color: primary ? tokens.primaryForeground : tokens.foreground,
            fontSize: 16,
            fontWeight: "500",
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
  function field(
    label: string,
    value: string,
    change: (value: string) => void,
    multiline = false,
    editable = true,
  ) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: tokens.foreground, fontSize: 15 }}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={change}
          editable={editable && !busy}
          multiline={multiline}
          autoCapitalize="sentences"
          maxLength={multiline ? 100000 : label === t("Name") ? 80 : 2000}
          style={{
            minHeight: multiline ? 240 : 48,
            textAlignVertical: multiline ? "top" : "center",
            borderRadius: multiline ? 24 : 9999,
            padding: 16,
            backgroundColor: tokens.muted,
            color: tokens.foreground,
            fontSize: 16,
          }}
        />
      </View>
    );
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 24, gap: 24, paddingBottom: 48 }}
    >
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
      {error ? action(t("Reload library"), () => void run(refresh)) : null}
      {busy ? (
        <ActivityIndicator accessibilityLabel={t("Saving…")} color={tokens.foreground} />
      ) : null}
      {editor ? (
        <>
          {editor === "new" ? (
            <>
              {field(t("Name"), name, setName)}
              {field(t("When to use it"), description, setDescription)}
            </>
          ) : (
            <Text style={{ color: tokens.foreground, fontSize: 20, fontWeight: "600" }}>
              {editor.name}
            </Text>
          )}
          {field(
            editor === "new" ? t("Steps and instructions") : "SKILL.md",
            content,
            setContent,
            true,
            editor === "new" || !editor.readOnly,
          )}
          {editor === "new" || !editor.readOnly
            ? action(
                t("Save"),
                () =>
                  void run(async () => {
                    if (editor === "new")
                      await rpc("agentSkills/create", {
                        content: buildSkillMd({
                          name,
                          description,
                          body: content,
                          frontmatter: copyOrigin,
                        }),
                      });
                    else await rpc("agentSkills/update", { skillId: editor.id, content });
                    setEditor(null);
                    await refreshSaved();
                  }),
                true,
              )
            : null}
          {editor !== "new" && editor.readOnly
            ? action(t("Make a copy"), () => {
                const parsed = parseSkillMd(content);
                const [, pluginId, ...path] = editor.id.split(":");
                setCopyOrigin(
                  editor.source === "plugin"
                    ? { "cadre-plugin-id": pluginId, "cadre-plugin-entry": path.join(":") }
                    : undefined,
                );
                setName(`${editor.name.slice(0, 65)} copy`);
                setDescription(editor.description);
                setContent("error" in parsed ? content : parsed.body);
                setEditor("new");
              })
            : null}
          {action(t("Back"), () => setEditor(null))}
        </>
      ) : pendingPlugin ? (
        <>
          {field(t("Plugin name"), pendingPlugin.name, (value) =>
            setPendingPlugin({ ...pendingPlugin, name: value.slice(0, 120) }),
          )}
          <Text style={{ color: tokens.mutedForeground }}>
            {t(
              "Plugin documents will be saved in this workspace. Hooks and servers are not activated by importing.",
            )}
          </Text>
          {action(
            t("Import plugin"),
            () =>
              void run(async () => {
                await rpc("capabilities/install", {
                  kind: "plugin",
                  name: pendingPlugin.name.trim(),
                  source: "workspace-upload",
                  config: validatePluginBundle(pendingPlugin),
                });
                setPendingPlugin(null);
                await refreshSaved();
              }),
            true,
            !pendingPlugin.name.trim(),
          )}
          {action(t("Back"), () => setPendingPlugin(null))}
        </>
      ) : (
        <>
          {action(
            t("New skill or workflow"),
            () => {
              setCopyOrigin(undefined);
              setName("");
              setDescription("");
              setContent("");
              setEditor("new");
            },
            true,
          )}
          {action(t("Import skill or plugin bundle"), () => void importFile())}
          {loading ? <ActivityIndicator color={tokens.foreground} /> : null}
          {plugins.length ? (
            <Text style={{ color: tokens.foreground, fontSize: 18, fontWeight: "600" }}>
              {t("Plugins")}
            </Text>
          ) : null}
          {plugins.map((plugin) => (
            <View key={plugin.id} style={{ gap: 8 }}>
              <Text style={{ color: tokens.foreground, fontSize: 16 }}>{plugin.name}</Text>
              {action(
                t("Export bundle"),
                () =>
                  void run(async () => {
                    if (!(await Sharing.isAvailableAsync()))
                      throw new Error(t("File sharing is unavailable on this device"));
                    const bundle = validatePluginBundle(plugin.config);
                    // The share sheet resolves before the target app reads the file on
                    // Android; the next export overwrites it, so leave it in the cache.
                    const file = new File(Paths.cache, `cadre-plugin-${plugin.id}.json`);
                    file.write(JSON.stringify({ ...bundle, name: plugin.name }));
                    await Sharing.shareAsync(file.uri, {
                      mimeType: "application/json",
                      UTI: "public.json",
                    });
                  }),
              )}
              {action(t("Remove"), () => remove(plugin))}
            </View>
          ))}
          <Text style={{ color: tokens.foreground, fontSize: 18, fontWeight: "600" }}>
            {t("Skills and workflows")}
          </Text>
          {skills
            .filter((skill) => skill.source !== "builtin")
            .map((skill) => (
              <View key={skill.id} style={{ gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  style={{ minHeight: 44, paddingVertical: 12 }}
                  onPress={() =>
                    void run(async () => {
                      const full = await rpc<AgentSkill>("agentSkills/get", { skillId: skill.id });
                      setEditor(full);
                      setContent(full.content);
                    })
                  }
                >
                  <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "500" }}>
                    {skill.name}
                  </Text>
                  <Text style={{ color: tokens.mutedForeground, fontSize: 14, marginTop: 8 }}>
                    {skill.description}
                  </Text>
                </Pressable>
                {!skill.readOnly ? action(t("Remove"), () => remove(skill)) : null}
              </View>
            ))}
          {!loading && !skills.some((skill) => skill.source !== "builtin") ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 16 }}>
              {t("Save instructions here, or ask an agent to create a reusable skill or workflow.")}
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
