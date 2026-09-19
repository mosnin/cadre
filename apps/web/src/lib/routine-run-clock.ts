export function routineRunClock(iso: string | null): { hour: number; minute: number } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { hour: date.getHours(), minute: date.getMinutes() };
}

export function routineClockSource(routine: {
  nextRunAt: string | null;
  lastRunAt: string | null;
}): string | null {
  return routine.nextRunAt ?? routine.lastRunAt;
}

/** Caps the cascade so a long list does not fire every row at once. */
export function routineNumberFlowDelayMs(index: number): number {
  return Math.min(Math.max(index, 0), 7) * 80;
}
