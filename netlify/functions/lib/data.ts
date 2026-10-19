// Loads intervals.icu data for a day and turns it into Metrics.
import type { DayRecord, Metrics } from "../../../shared/schemas";
import { getActivities, getWellness, summarise } from "./intervals";
import { computeMetrics } from "./metrics";
import { addDays } from "./dates";

export const WELLNESS_DAYS = 42;
export const ACTIVITY_DAYS = 14;

export async function loadMetrics(date: string): Promise<Metrics> {
  const [wellness, acts] = await Promise.all([
    getWellness(addDays(date, -(WELLNESS_DAYS - 1)), date),
    getActivities(addDays(date, -(ACTIVITY_DAYS - 1)), date),
  ]);
  return computeMetrics(date, wellness, acts.activities.map(summarise), acts.hidden);
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
