// Loads intervals.icu data for a day and turns it into Metrics.
import type { DayRecord, Metrics } from "../../shared/schemas";
import { getActivities, getAthlete, getMaxHeartRates, getPaceCurve, getWellness, summarise, type Athlete } from "./intervals";
import { ESTIMATE_DAYS, eftpFromWellness, runThreshold, swimCss } from "./estimates";
import { computeMetrics } from "./metrics";
import { buildThresholds, heartZoneBounds, measuredMaxHr, runPaceAtHr, typicalValues } from "./thresholds";
import { addDays } from "./dates";

export const WELLNESS_DAYS = 42;
export const ACTIVITY_DAYS = 14; // shown on Today and sent session by session
export const TYPICAL_DAYS = 42; // used for typical paces and power

// Resting HR for heart rate reserve zones: the 28-day average, else the latest value.
function restingHr(m: Pick<Metrics, "baselines" | "latest" | "today">): { value: number; basis: string } | null {
  const b = m.baselines.resting_hr;
  if (b.mean28 !== null && b.n28 >= 7) return { value: b.mean28, basis: `28-day average of ${b.n28} days` };
  const v = m.today.resting_hr ?? m.latest?.resting_hr?.value ?? null;
  return v !== null ? { value: v, basis: "latest value" } : null;
}

// Settings are not needed here any more: every number comes from the data.
export async function loadMetrics(date: string): Promise<Metrics> {
  const [wellness, acts, athlete, runCurve, swimCurve, maxHrs] = await Promise.all([
    getWellness(addDays(date, -(WELLNESS_DAYS - 1)), date),
    getActivities(addDays(date, -(TYPICAL_DAYS - 1)), date),
    // Sport settings are a nice-to-have: if this call fails, Today still loads.
    getAthlete().catch((e): Athlete | null => {
      console.warn("Could not read intervals.icu sport settings", e);
      return null;
    }),
    // Pace curves feed the threshold estimates; also optional.
    getPaceCurve("Run", date, ESTIMATE_DAYS),
    getPaceCurve("Swim", date, ESTIMATE_DAYS),
    getMaxHeartRates(date).catch(() => []),
  ]);
  const maxHrValue = measuredMaxHr(maxHrs);
  const maxHr = maxHrValue ? { value: maxHrValue, basis: "highest reliable max HR in your sessions over the last 12 months" } : null;
  const estimates = {
    ftp: eftpFromWellness(wellness, date),
    run: runThreshold(runCurve),
    swim: swimCss(swimCurve),
  };
  const all = acts.activities.map(summarise);
  const from14 = addDays(date, -(ACTIVITY_DAYS - 1));
  const metrics = computeMetrics(date, wellness, all.filter((a) => a.date >= from14), acts.hidden);
  const rest = restingHr(metrics);
  return {
    ...metrics,
    thresholds: buildThresholds(athlete, estimates, maxHr, rest),
    run_pace_at_hr: maxHr ? runPaceAtHr(all, heartZoneBounds(maxHr.value, rest?.value ?? null), TYPICAL_DAYS) : null,
    trend: wellness.map((w) => ({ date: w.id, ctl: w.ctl, atl: w.atl })),
    last_pool_length: all.find((a) => a.sport === "swim" && a.pool_length)?.pool_length ?? null,
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
