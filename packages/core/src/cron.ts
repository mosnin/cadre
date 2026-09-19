import { Cron } from "croner";

const WEEKDAYS = "1-5";

export const ONCE_ROUTINE_CRON = "@once";

export function isOneShotRoutineCron(cron: string): boolean {
  return cron.trim() === ONCE_ROUTINE_CRON;
}

// A routine is one-shot only when it has exactly one schedule and that
// schedule is @once — a mix of @once plus recurring schedules doesn't make
// sense (the one-shot slot would never get a "next run" to compute).
export function isOneShotRoutineCrons(crons: string[]): boolean {
  return crons.length === 1 && isOneShotRoutineCron(crons[0] ?? "");
}

// True when @once is combined with any other schedule — never valid, since
// the one-shot slot has no "next run" to compute and would sit inert
// forever. Callers that persist crons must reject this rather than let
// isOneShotRoutineCrons quietly classify the array as recurring.
export function hasMixedOneShotSchedule(crons: string[]): boolean {
  return crons.length > 1 && crons.some(isOneShotRoutineCron);
}

export const CRON_FREQS = [
  "Every hour",
  "Every day",
  "Weekdays",
  "Every week",
  "Every month",
  "Interval",
  "Advanced",
] as const;

export type CronFreq = (typeof CRON_FREQS)[number];
export type CronUnit = "minutes" | "hours" | "days";

export type CronPreset = {
  freq: CronFreq;
  n: number;
  unit: CronUnit;
  /** Clock time for the timed presets, in "h:mm AM" form. */
  time: string;
  /** Day of week for "Every week": 0 is Sunday, 6 is Saturday. */
  weekday: number;
  /** Day of month for "Every month", 1 to 31. */
  day: number;
  cron: string;
};

export type CronPresetInput = {
  freq: CronFreq;
  n?: number;
  unit?: CronUnit;
  time?: string;
  weekday?: number;
  day?: number;
  cron?: string;
};

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function defaultCronPreset(): CronPreset {
  return {
    freq: "Every day",
    n: 3,
    unit: "minutes",
    time: "9:00 AM",
    weekday: 1,
    day: 1,
    cron: "",
  };
}

function boundedWeekday(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6
    ? (value as number)
    : 1;
}

function boundedMonthDay(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 31
    ? (value as number)
    : 1;
}

/** "1st", "2nd", "3rd", "11th", "22nd" for schedule descriptions. */
export function ordinalDay(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const mod10 = day % 10;
  return `${day}${mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th"}`;
}

/** "9:00 AM" to "09:00" for a native time input; empty when the value cannot be read. */
export function clockTo24h(time: string): string {
  const { hour, minute } = parseClock(time);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "09:05" or "21:30" from a native time input to the preset's "h:mm AM" form. */
export function clockFrom24h(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return formatClock(hour, minute);
}

export function cronFromPreset(input: CronPresetInput): string {
  const advancedCron = input.cron?.trim();
  if (input.freq === "Advanced") {
    if (advancedCron && isOneShotRoutineCron(advancedCron)) return ONCE_ROUTINE_CRON;
    return advancedCron || "*/3 * * * *";
  }
  if (input.freq === "Every hour") return "0 * * * *";
  if (input.freq === "Interval") {
    const n = Number.isFinite(input.n) && (input.n ?? 0) > 0 ? (input.n as number) : 5;
    if (input.unit === "days") return `0 0 */${n} * *`;
    if (input.unit === "hours") return `0 */${n} * * *`;
    return `*/${n} * * * *`;
  }
  const { hour, minute } = parseClock(input.time ?? "9:00 AM");
  if (input.freq === "Weekdays") return `${minute} ${hour} * * ${WEEKDAYS}`;
  if (input.freq === "Every week") return `${minute} ${hour} * * ${boundedWeekday(input.weekday)}`;
  if (input.freq === "Every month") return `${minute} ${hour} ${boundedMonthDay(input.day)} * *`;
  return `${minute} ${hour} * * *`;
}

export function presetFromCron(cron: string): CronPreset {
  const base = defaultCronPreset();
  const trimmed = cron.trim();
  if (isOneShotRoutineCron(trimmed)) {
    return { ...base, freq: "Advanced", cron: ONCE_ROUTINE_CRON };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) {
    return { ...base, freq: "Advanced", cron: trimmed };
  }
  const minute = parts[0] ?? "*";
  const hour = parts[1] ?? "*";
  const day = parts[2] ?? "*";
  const month = parts[3] ?? "*";
  const dow = parts[4] ?? "*";
  if (month !== "*") {
    return { ...base, freq: "Advanced", cron: trimmed };
  }

  const minuteStep = stepValue(minute);
  const hourStep = stepValue(hour);
  const dayStep = stepValue(day);

  if (minute === "0" && hour === "*" && day === "*" && dow === "*") {
    return { ...base, freq: "Every hour" };
  }
  if (minuteStep && hour === "*" && day === "*" && dow === "*") {
    return { ...base, freq: "Interval", n: minuteStep, unit: "minutes" };
  }
  if (minute === "0" && hourStep && day === "*" && dow === "*") {
    return { ...base, freq: "Interval", n: hourStep, unit: "hours" };
  }
  if (minute === "0" && hour === "0" && dayStep && dow === "*") {
    return { ...base, freq: "Interval", n: dayStep, unit: "days" };
  }
  if (!isInt(minute) || !isInt(hour)) {
    return { ...base, freq: "Advanced", cron: trimmed };
  }

  const time = formatClock(Number(hour), Number(minute));
  if (day === "*" && dow === WEEKDAYS) {
    return { ...base, freq: "Weekdays", time };
  }
  if (day === "*" && isInt(dow) && Number(dow) >= 0 && Number(dow) <= 7) {
    // Cron accepts 7 for Sunday as well as 0.
    return { ...base, freq: "Every week", time, weekday: Number(dow) % 7 };
  }
  if (isInt(day) && Number(day) >= 1 && Number(day) <= 31 && dow === "*") {
    return { ...base, freq: "Every month", time, day: Number(day) };
  }
  if (day === "*" && dow === "*") {
    return { ...base, freq: "Every day", time };
  }
  return { ...base, freq: "Advanced", cron: trimmed };
}

export function describeCronPreset(preset: CronPreset): { lead: string; detail: string } {
  if (preset.freq === "Interval") {
    return { lead: "Every", detail: `${preset.n} ${preset.unit}` };
  }
  if (preset.freq === "Every hour") {
    return { lead: "Every hour", detail: "" };
  }
  if (preset.freq === "Advanced") {
    return { lead: "Cron", detail: preset.cron || "*/3 * * * *" };
  }
  if (preset.freq === "Weekdays") {
    return { lead: "Weekdays", detail: `at ${preset.time}` };
  }
  if (preset.freq === "Every week") {
    return {
      lead: `Every ${WEEKDAY_NAMES[boundedWeekday(preset.weekday)]}`,
      detail: `at ${preset.time}`,
    };
  }
  if (preset.freq === "Every month") {
    return {
      lead: "Monthly",
      detail: `on the ${ordinalDay(boundedMonthDay(preset.day))} at ${preset.time}`,
    };
  }
  return { lead: "Every day", detail: `at ${preset.time}` };
}

export function formatSchedule(preset: CronPreset): string {
  const { lead, detail } = describeCronPreset(preset);
  return [lead, detail].filter(Boolean).join(" ");
}

export function formatCron(cron: string): string {
  if (isOneShotRoutineCron(cron)) return "One-time";
  return formatSchedule(presetFromCron(cron));
}

export function resolveRoutineNextRunAt(
  cron: string,
  from: Date,
  timezone: string,
  existing: Date | null | undefined,
): Date | null {
  if (isOneShotRoutineCron(cron)) return existing ?? null;
  return nextCronDate(cron, from, timezone);
}

export function nextCronDate(cron: string, from: Date, timezone = "UTC"): Date {
  if (isOneShotRoutineCron(cron)) {
    throw new Error("nextCronDate does not apply to one-shot routines");
  }
  if (cron.trim().split(/\s+/).length !== 5) {
    throw new RangeError("Cron expressions must contain five fields");
  }
  const schedule = new Cron(cron, {
    paused: true,
    timezone: validTimezoneOrUtc(timezone),
  });
  const next = schedule.nextRun(from);
  if (!next) throw new RangeError(`Cron expression has no future run: ${cron}`);
  return next;
}

// Nearest next run across every recurring schedule on a routine. Ignores
// @once slots (they don't recur) and any schedule that fails to parse. Only
// the wakeup path (packages/adapters/src/executor.ts) should use this —
// legacy or hand-edited records may carry a stale cron, and skipping it
// there is safer than crashing the wakeup job. Anything that persists a
// routine's crons must reject malformed input instead — see
// nextCronDateAcrossStrict.
export function nextCronDateAcross(crons: string[], from: Date, timezone = "UTC"): Date | null {
  let earliest: Date | null = null;
  for (const cron of crons) {
    if (isOneShotRoutineCron(cron)) continue;
    let next: Date;
    try {
      next = nextCronDate(cron, from, timezone);
    } catch {
      continue;
    }
    if (!earliest || next < earliest) earliest = next;
  }
  return earliest;
}

// Same as nextCronDateAcross, but throws on the first malformed recurring
// cron instead of silently skipping it. Use this before persisting a
// routine's crons — a partially-invalid array should be rejected outright,
// not saved with the bad entry quietly never firing.
export function nextCronDateAcrossStrict(
  crons: string[],
  from: Date,
  timezone = "UTC",
): Date | null {
  let earliest: Date | null = null;
  for (const cron of crons) {
    if (isOneShotRoutineCron(cron)) continue;
    const next = nextCronDate(cron, from, timezone);
    if (!earliest || next < earliest) earliest = next;
  }
  return earliest;
}

function validTimezoneOrUtc(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function parseClock(time: string): { hour: number; minute: number } {
  const [rawH, rest] = time.split(":");
  const minute = Number((rest ?? "00").slice(0, 2));
  let hour = Number(rawH);
  if (/pm/i.test(time) && hour < 12) hour += 12;
  if (/am/i.test(time) && hour === 12) hour = 0;
  return { hour, minute };
}

function formatClock(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}

function stepValue(expr: string): number | null {
  const match = /^\*\/(\d+)$/.exec(expr);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isInt(expr: string): boolean {
  return /^\d+$/.test(expr);
}
