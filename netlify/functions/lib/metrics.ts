// Readiness metrics and flags. Pure functions so they can be tested without network.
import type { ActivitySummary, Flag, Metrics } from "../../../shared/schemas";
import type { Wellness } from "./intervals";
import { addDays } from "./dates";

export const MIN_DAYS_FOR_RANGE = 10;
export const FLAG_RULE =
  "A value is flagged when it is more than 1 standard deviation away from its mean over the 28 days before today " +
  `(today not included). At least ${MIN_DAYS_FOR_RANGE} days with data are needed; otherwise no range is shown.`;

const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// Sample standard deviation (n - 1).
export function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

type Pick = (w: Wellness) => number | null;

const PICKS: Record<"hrv" | "resting_hr" | "sleep_hours", { label: string; unit: string; pick: Pick }> = {
  hrv: { label: "HRV", unit: "ms", pick: (w) => w.hrv },
  resting_hr: { label: "Resting HR", unit: "bpm", pick: (w) => w.restingHR },
  sleep_hours: {
    label: "Sleep",
    unit: "h",
    pick: (w) => (w.sleepSecs === null ? null : round(w.sleepSecs / 3600, 2)),
  },
};

function valuesBetween(byDay: Map<string, Wellness>, pick: Pick, from: string, to: string): number[] {
  const out: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = byDay.get(d);
    const v = w ? pick(w) : null;
    if (v !== null) out.push(v);
  }
  return out;
}

export function baseline(byDay: Map<string, Wellness>, pick: Pick, date: string) {
  const prior28 = valuesBetween(byDay, pick, addDays(date, -28), addDays(date, -1));
  const prior7 = valuesBetween(byDay, pick, addDays(date, -7), addDays(date, -1));
  const m7 = mean(prior7);
  const m28 = mean(prior28);
  const s28 = sd(prior28);
  return {
    mean7: m7 === null ? null : round(m7),
    mean28: m28 === null ? null : round(m28),
    sd28: s28 === null ? null : round(s28),
    n28: prior28.length,
  };
}

export function flagFor(
  metric: keyof typeof PICKS,
  value: number | null,
  b: ReturnType<typeof baseline>,
): Flag | null {
  if (value === null || b.mean28 === null || b.sd28 === null || b.n28 < MIN_DAYS_FOR_RANGE) return null;
  const low = round(b.mean28 - b.sd28);
  const high = round(b.mean28 + b.sd28);
  if (value >= low && value <= high) return null;
  const { label, unit } = PICKS[metric];
  const direction = value < low ? "below" : "above";
  return {
    metric,
    label,
    value,
    mean28: b.mean28,
    sd28: b.sd28,
    low,
    high,
    direction,
    rule: `${label} ${value} ${unit} is ${direction} the normal range ${low} to ${high} ${unit} (28-day mean ${b.mean28} +/- 1 SD of ${b.sd28}).`,
  };
}

function emptyTotals() {
  return { sessions: 0, minutes: 0, load: 0, distance_km: 0 };
}

export function weeklyTotals(activities: ActivitySummary[], date: string): Metrics["last7"] {
  const from = addDays(date, -6);
  const totals = { swim: emptyTotals(), bike: emptyTotals(), run: emptyTotals(), other: emptyTotals() };
  for (const a of activities) {
    if (a.date < from || a.date > date) continue;
    const t = totals[a.sport];
    t.sessions += 1;
    t.minutes += a.minutes ?? 0;
    t.load += a.load ?? 0;
    t.distance_km = round(t.distance_km + (a.distance_km ?? 0), 2);
  }
  return totals;
}

export function computeMetrics(
  date: string,
  wellness: Wellness[],
  activities: ActivitySummary[],
  hidden: number,
): Metrics {
  const byDay = new Map(wellness.map((w) => [w.id, w]));
  const today = byDay.get(date);
  const t = {
    hrv: today ? PICKS.hrv.pick(today) : null,
    resting_hr: today ? PICKS.resting_hr.pick(today) : null,
    sleep_hours: today ? PICKS.sleep_hours.pick(today) : null,
  };
  const baselines = {
    hrv: baseline(byDay, PICKS.hrv.pick, date),
    resting_hr: baseline(byDay, PICKS.resting_hr.pick, date),
    sleep_hours: baseline(byDay, PICKS.sleep_hours.pick, date),
  };
  const flags = (Object.keys(t) as (keyof typeof t)[])
    .map((k) => flagFor(k, t[k], baselines[k]))
    .filter((f): f is Flag => f !== null);
  const ctl = today?.ctl ?? null;
  const atl = today?.atl ?? null;
  return {
    date,
    today: {
      hrv: t.hrv,
      resting_hr: t.resting_hr,
      sleep_hours: t.sleep_hours,
      sleep_score: today?.sleepScore ?? null,
      ctl: ctl === null ? null : round(ctl),
      atl: atl === null ? null : round(atl),
      tsb: ctl === null || atl === null ? null : round(ctl - atl),
      weight: today?.weight ?? null,
    },
    baselines,
    flags,
    flag_rule: FLAG_RULE,
    last7: weeklyTotals(activities, date),
    activities14: [...activities].sort((a, b) => b.start_local.localeCompare(a.start_local)),
    hidden_activities: hidden,
  };
}
