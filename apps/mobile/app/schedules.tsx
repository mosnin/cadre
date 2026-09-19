import type { Routine } from "@cadre/contracts";
import {
  type CronFreq,
  type CronPreset,
  cronFromPreset,
  formatCron,
  isOneShotRoutineCrons,
  ordinalDay,
  presetFromCron,
} from "@cadre/core";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

const PICKER_FREQS: CronFreq[] = ["Every day", "Weekdays", "Every week", "Every month"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function presetTimeAsDate(preset: CronPreset): Date {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(preset.time.trim());
  const date = new Date();
  let hour = match ? Number(match[1]) % 12 : 9;
  if (match && match[3]?.toUpperCase() === "PM") hour += 12;
  date.setHours(hour, match ? Number(match[2]) : 0, 0, 0);
  return date;
}

function clockFromDate(date: Date): string {
  const hour = date.getHours();
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(date.getMinutes()).padStart(2, "0")} ${period}`;
}

type Draft = {
  routine?: Routine;
  name: string;
  prompt: string;
  crons: string;
  timezone: string;
  active: boolean;
  notify: boolean;
};

export default function Schedules() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const [rows, setRows] = useState<Routine[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setDraft(null);
    setRows([]);
    setLoading(true);
    setError(null);
    if (!botId) {
      setError(t("Select an agent first"));
      setLoading(false);
      return;
    }
    void rpc<Routine[]>("routines/list", { botId })
      .then((items) => {
        if (generation.current === request) setRows(items);
      })
      .catch((reason) => {
        if (generation.current === request)
          setError(reason instanceof Error ? reason.message : t("Could not load schedules"));
      })
      .finally(() => {
        if (generation.current === request) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [botId]);

  function edit(routine?: Routine) {
    setError(null);
    setDraft({
      routine,
      name: routine?.name ?? "",
      prompt: routine?.prompt ?? "",
      crons: routine?.crons.join("\n") ?? "0 9 * * *",
      timezone: routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      active: routine?.active ?? true,
      notify: routine?.notify ?? true,
    });
  }
  async function save() {
    if (!draft || !botId || pending.current) return;
    const request = generation.current;
    if (!draft.name.trim() || !draft.prompt.trim()) {
      setError(t("Enter a name and instruction"));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const crons = draft.crons
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const input = {
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        crons,
        timezone: draft.timezone,
        active: draft.active,
        notify: draft.notify,
        webhookEnabled: draft.routine?.webhookEnabled ?? false,
      };
      const saved = draft.routine
        ? await rpc<Routine>("routines/update", { routineId: draft.routine.id, ...input })
        : await rpc<Routine>("routines/create", { botId, ...input });
      if (generation.current !== request) return;
      setRows((items) => [...items.filter((item) => item.id !== saved.id), saved]);
      setDraft(null);
    } catch (reason) {
      if (generation.current === request)
        setError(reason instanceof Error ? reason.message : t("Could not save schedule"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function remove(routine: Routine) {
    Alert.alert(t("Delete schedule?"), routine.name, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () => {
          if (pending.current) return;
          const request = generation.current;
          pending.current = true;
          setBusy(true);
          setError(null);
          void rpc("routines/remove", { routineId: routine.id })
            .then(() => {
              if (generation.current === request) {
                setRows((items) => items.filter((item) => item.id !== routine.id));
                setDraft(null);
              }
            })
            .catch((reason) => {
              if (generation.current === request)
                setError(reason instanceof Error ? reason.message : t("Could not delete schedule"));
            })
            .finally(() => {
              pending.current = false;
              setBusy(false);
            });
        },
      },
    ]);
  }
  const fieldStyle = {
    color: tokens.foreground,
    backgroundColor: tokens.muted,
    borderRadius: 11,
    padding: 14,
    fontSize: 16,
  };
  const buttonStyle = {
    padding: 12,
    borderRadius: 11,
    backgroundColor: tokens.muted,
    opacity: busy ? 0.5 : 1,
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 24, gap: 18 }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t("Schedules") }} />
      {loading ? <ActivityIndicator /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
      {!loading && !draft ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={!botId || busy}
            onPress={() => edit()}
            style={buttonStyle}
          >
            <Text style={{ color: tokens.foreground }}>{t("New schedule")}</Text>
          </Pressable>
          {rows.length === 0 ? (
            <Text style={{ color: tokens.mutedForeground }}>{t("No schedules yet")}</Text>
          ) : null}
          {rows.map((routine) => (
            <Pressable
              key={routine.id}
              accessibilityRole="button"
              onPress={() => edit(routine)}
              style={buttonStyle}
            >
              <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "600" }}>
                {routine.name}
              </Text>
              <Text style={{ color: tokens.mutedForeground }}>
                {routine.active
                  ? routine.crons.map(formatCron).join(" · ") || t("Webhook")
                  : t("Paused")}
              </Text>
              {routine.nextRunAt ? (
                <Text style={{ color: tokens.mutedForeground }}>
                  {new Date(routine.nextRunAt).toLocaleString(undefined, {
                    timeZone: routine.timezone,
                  })}{" "}
                  · {routine.timezone}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </>
      ) : null}
      {draft ? (
        <>
          <Text style={{ color: tokens.mutedForeground }}>{t("Name")}</Text>
          <TextInput
            accessibilityLabel={t("Name")}
            editable={!busy}
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            style={fieldStyle}
          />
          <Text style={{ color: tokens.mutedForeground }}>{t("Instruction")}</Text>
          <TextInput
            accessibilityLabel={t("Instruction")}
            editable={!busy}
            multiline
            value={draft.prompt}
            onChangeText={(prompt) => setDraft({ ...draft, prompt })}
            style={[fieldStyle, { minHeight: 100, textAlignVertical: "top" }]}
          />
          <SchedulePicker
            crons={draft.crons}
            disabled={busy}
            onChange={(crons) => setDraft({ ...draft, crons })}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[[t("Hourly"), "0 * * * *"]].map(([label, crons]) => (
              <Pressable
                key={crons}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setDraft({ ...draft, crons: crons! })}
                style={buttonStyle}
              >
                <Text style={{ color: tokens.foreground }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: tokens.mutedForeground }}>
            {t("Schedule expressions, one per line")}
          </Text>
          <TextInput
            accessibilityLabel={t("Schedule expressions, one per line")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            multiline
            value={draft.crons}
            onChangeText={(crons) => setDraft({ ...draft, crons })}
            style={fieldStyle}
          />
          <Text style={{ color: tokens.mutedForeground }}>{t("Time zone")}</Text>
          <TextInput
            accessibilityLabel={t("Time zone")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            value={draft.timezone}
            onChangeText={(timezone) => setDraft({ ...draft, timezone })}
            style={fieldStyle}
          />
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <Text style={{ color: tokens.foreground }}>{t("Active")}</Text>
            <Switch
              accessibilityLabel={t("Active")}
              disabled={
                busy ||
                Boolean(
                  !draft.active &&
                    !draft.routine?.nextRunAt &&
                    isOneShotRoutineCrons(
                      draft.crons
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    ),
                )
              }
              value={draft.active}
              onValueChange={(active) => setDraft({ ...draft, active })}
            />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <Text style={{ color: tokens.foreground }}>{t("Notify me")}</Text>
            <Switch
              accessibilityLabel={t("Notify me")}
              disabled={busy}
              value={draft.notify}
              onValueChange={(notify) => setDraft({ ...draft, notify })}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void save()}
            style={{ ...buttonStyle, backgroundColor: tokens.primary }}
          >
            <Text style={{ color: tokens.primaryForeground }}>
              {busy ? t("Saving…") : t("Save")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setDraft(null);
              setError(null);
            }}
            style={buttonStyle}
          >
            <Text style={{ color: tokens.foreground }}>{t("Cancel")}</Text>
          </Pressable>
          {draft.routine ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => remove(draft.routine!)}
              style={buttonStyle}
            >
              <Text style={{ color: tokens.destructive }}>{t("Delete schedule")}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

/** Exact-time schedule picker: frequency, then the day and the native time picker. */
function SchedulePicker({
  crons,
  disabled,
  onChange,
}: {
  crons: string;
  disabled: boolean;
  onChange: (crons: string) => void;
}) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const [showTime, setShowTime] = useState(Platform.OS === "ios");
  const firstLine = crons.split("\n").find((line) => line.trim()) ?? "";
  const preset = presetFromCron(firstLine);
  const representable = PICKER_FREQS.includes(preset.freq);
  const freqLabels: Record<string, string> = {
    "Every day": t("Every day"),
    Weekdays: t("Weekdays"),
    "Every week": t("Every week"),
    "Every month": t("Every month"),
  };
  const weekdayLabels = [t("Sun"), t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat")];
  function apply(partial: Partial<CronPreset>) {
    const base = representable ? preset : { ...preset, freq: "Every day" as CronFreq };
    onChange(cronFromPreset({ ...base, ...partial }));
  }
  const chip = (selected: boolean) => ({
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 11,
    backgroundColor: selected ? tokens.primary : tokens.muted,
    opacity: disabled ? 0.5 : 1,
  });
  const chipText = (selected: boolean) => ({
    color: selected ? tokens.primaryForeground : tokens.foreground,
  });
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PICKER_FREQS.map((freq) => {
          const selected = representable && preset.freq === freq;
          return (
            <Pressable
              key={freq}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={disabled}
              onPress={() => apply({ freq })}
              style={chip(selected)}
            >
              <Text style={chipText(selected)}>{freqLabels[freq]}</Text>
            </Pressable>
          );
        })}
      </View>
      {representable && preset.freq === "Every week" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {WEEKDAY_ORDER.map((weekday) => {
            const selected = preset.weekday === weekday;
            return (
              <Pressable
                key={weekday}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={disabled}
                onPress={() => apply({ weekday })}
                style={chip(selected)}
              >
                <Text style={chipText(selected)}>{weekdayLabels[weekday]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {representable && preset.freq === "Every month" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: tokens.mutedForeground }}>{t("Day of month")}</Text>
          <TextInput
            accessibilityLabel={t("Day of month")}
            inputMode="numeric"
            editable={!disabled}
            value={String(preset.day)}
            onChangeText={(text) => {
              const day = Number(text);
              if (Number.isInteger(day) && day >= 1 && day <= 31) apply({ day });
            }}
            style={{
              color: tokens.foreground,
              backgroundColor: tokens.muted,
              borderRadius: 11,
              paddingVertical: 8,
              paddingHorizontal: 12,
              fontSize: 16,
              minWidth: 64,
            }}
          />
          <Text style={{ color: tokens.mutedForeground }}>{ordinalDay(preset.day)}</Text>
        </View>
      ) : null}
      {representable ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: tokens.mutedForeground }}>{t("Time")}</Text>
          {Platform.OS === "android" ? (
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => setShowTime(true)}
              style={chip(false)}
            >
              <Text style={chipText(false)}>{preset.time}</Text>
            </Pressable>
          ) : null}
          {showTime ? (
            <DateTimePicker
              mode="time"
              value={presetTimeAsDate(preset)}
              disabled={disabled}
              onChange={(event, date) => {
                if (Platform.OS === "android") setShowTime(false);
                if (event.type === "dismissed" || !date) return;
                apply({ time: clockFromDate(date) });
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
