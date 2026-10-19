// Loads intervals.icu data for a day and turns it into Metrics.
import type { DayRecord, Metrics, Settings } from "../../../shared/schemas";
import { getActivities, getAthlete, getWellness, summarise, type Athlete } from "./intervals";
import { computeMetrics } from "./metrics";
import { buildThresholds, typicalValues } from "./thresholds";
import { addDays } from "./dates";
import { getSettings } from "./store";

export const WELLNESS_DAYS = 42;
export const ACTIVITY_DAYS = 14; // shown on Today and sent session by session
export const TYPICAL_DAYS = 42; // used for typical paces and power

export async function loadMetrics(date: string, settingsIn?: Settings): Promise<Metrics> {
  const [wellness, acts, athlete, settings] = await Promise.all([
    getWellness(addDays(date, -(WELLNESS_DAYS - 1)), date),
    getActivities(addDays(date, -(TYPICAL_DAYS - 1)), date),
    // Sport settings are a nice-to-have: if this call fails, Today still loads.
    getAthlete().catch((e): Athlete | null => {
      console.warn("Could not read intervals.icu sport settings", e);
      return null;
    }),
    settingsIn ?? getSettings(),
  ]);
  const all = acts.activities.map(summarise);
  const from14 = addDays(date, -(ACTIVITY_DAYS - 1));
  const metrics = computeMetrics(date, wellness, all.filter((a) => a.date >= from14), acts.hidden);
  return {
    ...metrics,
    thresholds: buildThresholds(athlete, settings.plan),
    typical: typicalValues(all, date, TYPICAL_DAYS),
  };
}

// Days before `date` that count as hard: a completed activity met the hard rule, or a
// stored plan was "hard" and was not reported as skipped.
export function hardDates(date: string, metrics: Metrics, history: DayRecord[]): string[] {
  const out = new Set<string>();
  for (const a of metrics.activities14) if (a.hard && a.date < date) out.add(a.date);
  for (const d of history) {
    if (d.date >= date || !d.plan || d.plan.intensity !== "hard") continue;
    if (d.feedback?.followed === "skipped") continue;
    out.add(d.date);
  }
  return [...out].sort();
}
