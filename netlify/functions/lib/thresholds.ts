// The athlete's own numbers, from data only: thresholds estimated from their sessions
// (estimates.ts), heart rate zones from their measured max HR, and typical values from
// the last 6 weeks. Values typed into intervals.icu settings are never used as numbers;
// when they exist they are reported as ignored. Pure functions, no network.
import type { ActivitySummary, RunPaceAtHr, Thresholds, Typical } from "../../../shared/schemas";
import type { Athlete, SportSettings } from "./intervals";
import type { Estimates } from "./estimates";

type Sport = "swim" | "bike" | "run";
const TYPES: Record<Sport, string[]> = {
  swim: ["Swim", "OpenWaterSwim"],
  bike: ["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"],
  run: ["Run", "TrailRun", "VirtualRun"],
};
const PER: Record<"swim" | "run", { metres: number; unit: string }> = {
  swim: { metres: 100, unit: "/100m" },
  run: { metres: 1000, unit: "/km" },
};

// Zone models (conventions, not measurements): intervals.icu's own when the athlete has
// them, else the standard ones. Power: Coggan 7 zones. Run pace: intervals.icu defaults.
const POWER_ZONES = [55, 75, 90, 105, 120, 150, 999];
const POWER_NAMES = ["Active Recovery", "Endurance", "Tempo", "Threshold", "VO2 Max", "Anaerobic", "Neuromuscular"];
const RUN_PACE_ZONES = [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999];
// Heart rate: % of measured max HR, the 5-zone model Garmin uses by default.
const HR_ZONES = [50, 60, 70, 80, 90, 100];
const HR_NAMES = ["Warm-up", "Easy", "Aerobic", "Threshold", "Maximum"];

const MISSING: Record<Sport, string> = {
  bike: "Needs one ride with power in intervals.icu (smart trainer rides count). Until then bike targets use heart rate.",
  run: "Needs a few hard efforts in the last 12 weeks, such as a 5 km race or a tempo run. Until then run targets use heart rate.",
  swim: "Needs a best 200 m and 400 m in the last 12 weeks. Until then swim targets use effort.",
};

export function fmtSecs(secs: number): string {
  const total = Math.round(secs);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// "5:10", "5:10/km", "2:05/100m" -> seconds per unit
export function parsePace(s: string): number | null {
  const m = /^\s*(\d{1,2}):([0-5]\d)/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function settingsFor(athlete: Athlete | null, sport: Sport): SportSettings | null {
  return athlete?.sportSettings.find((s) => s.types.some((t) => TYPES[sport].includes(t))) ?? null;
}

// "Z2 Endurance", or just "Z2" when there is no name for the zone.
function zoneLabel(i: number, name: string | undefined): string {
  return name ? `Z${i + 1} ${name}` : `Z${i + 1}`;
}

function powerZones(s: SportSettings | null, ftp: number): string[] {
  const zones = s && s.power_zones.length ? s.power_zones : POWER_ZONES;
  const names = s && s.power_zones.length ? s.power_zone_names : POWER_NAMES;
  return zones.map((upper, i) => {
    const name = zoneLabel(i, names[i]);
    const from = i === 0 ? 0 : zones[i - 1];
    if (upper >= 500) return `${name}: above ${from}% FTP (${Math.round((from * ftp) / 100)} W)`;
    return `${name}: ${from} to ${upper}% FTP (${Math.round((from * ftp) / 100)} to ${Math.round((upper * ftp) / 100)} W)`;
  });
}

// pace_zones are % of threshold speed; a higher % is faster.
function paceZones(s: SportSettings | null, sport: "swim" | "run", thresholdSecs: number): string[] {
  const zones = s && s.pace_zones.length ? s.pace_zones : sport === "run" ? RUN_PACE_ZONES : [];
  const names = s && s.pace_zones.length ? s.pace_zone_names : [];
  const { unit } = PER[sport];
  const pace = (pct: number) => fmtSecs(thresholdSecs / (pct / 100));
  return zones.map((upper, i) => {
    const name = zoneLabel(i, names[i]);
    const from = i === 0 ? 0 : zones[i - 1];
    if (from === 0) return `${name}: slower than ${pace(upper)}${unit}`;
    if (upper >= 500) return `${name}: faster than ${pace(from)}${unit}`;
    return `${name}: ${pace(from)} to ${pace(upper)}${unit}`;
  });
}

// Zones as % of heart rate reserve (max minus resting), Garmin's "%HRR" option, when the
// resting HR is known; otherwise as % of max HR, which puts the low zones too low for
// trained athletes.
export interface HrZone {
  zone: number;
  name: string;
  lo: number;
  hi: number;
}
export function heartZoneBounds(maxHr: number, restHr: number | null = null): HrZone[] {
  const rest = restHr !== null && restHr >= 30 && restHr < maxHr - 40 ? restHr : 0;
  return HR_NAMES.map((name, i) => ({
    zone: i + 1,
    name,
    lo: Math.round(rest + (HR_ZONES[i] * (maxHr - rest)) / 100),
    hi: Math.round(rest + (HR_ZONES[i + 1] * (maxHr - rest)) / 100),
  }));
}
export function heartZones(maxHr: number, restHr: number | null = null): string[] {
  return heartZoneBounds(maxHr, restHr).map((z) => `Z${z.zone} ${z.name}: ${z.lo} to ${z.hi} bpm`);
}

// Parses "Z2 Easy: 143 to 158 bpm" back into bounds (for day records that stored text).
export function parseHeartZones(zones: string[]): HrZone[] {
  return zones.flatMap((z) => {
    const m = /^Z(\d) ([^:]+): (\d+) to (\d+) bpm$/.exec(z);
    return m ? [{ zone: Number(m[1]), name: m[2], lo: Number(m[3]), hi: Number(m[4]) }] : [];
  });
}

// How fast the athlete runs at each heart rate, from their own runs: each run's average
// heart rate and average pace, with a straight line fitted through them (pace gets
// faster as heart rate goes up). A zone gets a pace only where the runs cover that heart
// rate (within 8 bpm), so it is never stretched far beyond the data. Hills and heat are not accounted for.
export const MIN_RUNS_FOR_PACE_AT_HR = 5;
export function runPaceAtHr(activities: ActivitySummary[], zones: HrZone[], days: number): RunPaceAtHr | null {
  const pts = activities
    .filter((a) => a.sport === "run" && (a.minutes ?? 0) >= 15 && a.avg_hr !== null && a.pace_per_km !== null)
    .map((a) => ({ hr: a.avg_hr!, pace: parsePace(a.pace_per_km!) }))
    .filter((p): p is { hr: number; pace: number } => p.pace !== null && p.pace >= 150 && p.pace <= 720 && p.hr >= 80);
  if (pts.length < MIN_RUNS_FOR_PACE_AT_HR || zones.length === 0) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.hr, 0) / n;
  const my = pts.reduce((a, p) => a + p.pace, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.hr - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.hr - mx) * (p.pace - my), 0);
  const minHr = Math.min(...pts.map((p) => p.hr));
  const maxHr = Math.max(...pts.map((p) => p.hr));
  // Needs some spread in heart rate, and pace must get faster as heart rate rises.
  if (sxx === 0 || maxHr - minHr < 8 || sxy >= 0) return null;
  const slope = sxy / sxx;
  const at = (hr: number) => my + slope * (hr - mx);
  const covered = (hr: number) => hr >= minHr - 8 && hr <= maxHr + 8;
  return {
    runs: n,
    basis: `average heart rate and pace of ${n} runs of 15 minutes or more in the last ${days} days, ${Math.round(minHr)} to ${Math.round(maxHr)} bpm`,
    zones: zones.map((z) => {
      const slow = covered(z.lo) ? Math.round(at(z.lo)) : null;
      const fast = covered(z.hi) ? Math.round(at(z.hi)) : null;
      const pace =
        slow !== null && fast !== null
          ? `about ${fmtSecs(slow)} to ${fmtSecs(fast)}/km`
          : slow !== null
            ? `about ${fmtSecs(slow)}/km at ${z.lo} bpm (no runs harder than ${Math.round(maxHr)} bpm yet)`
            : fast !== null
              ? `about ${fmtSecs(fast)}/km at ${z.hi} bpm (no runs easier than ${Math.round(minHr)} bpm yet)`
              : "no runs at this heart rate yet";
      return { zone: z.zone, name: z.name, hr_low: z.lo, hr_high: z.hi, pace_slow: slow, pace_fast: fast, text: `Z${z.zone} ${z.name}, ${z.lo} to ${z.hi} bpm: ${pace}` };
    }),
  };
}

// Highest reliable max HR seen in sessions. Optical sensors sometimes record one-off
// spikes, so a top value counts only when another session comes within 5 bpm of it, or
// when it came from a hard session (average HR at least 75% of that max) and is no more
// than 15 bpm above the next highest. Otherwise the next value is tried.
export type SessionHr = number | { max: number; avg: number | null } | null | undefined;
export function measuredMaxHr(values: SessionHr[]): number | null {
  const v = values
    .map((x) => (typeof x === "number" ? { max: x, avg: null } : x && typeof x.max === "number" ? x : null))
    .filter((x): x is { max: number; avg: number | null } => x !== null && x.max >= 120 && x.max <= 225)
    .sort((a, b) => b.max - a.max);
  if (v.length === 0) return null;
  for (let i = 0; i < v.length - 1; i++) {
    const gap = v[i].max - v[i + 1].max;
    const hard = v[i].avg !== null && v[i].avg! >= 0.75 * v[i].max;
    if (gap <= 5 || (hard && gap <= 15)) return Math.round(v[i].max);
  }
  return Math.round(v[v.length - 1].max);
}

// A value typed in intervals.icu settings is reported, not used. When it matches the
// measured value there is nothing to report.
function ignoredText(sport: Sport, s: SportSettings | null, measured: string | null): string | null {
  let typed: string | null = null;
  if (sport === "bike" && s?.ftp) typed = `${s.ftp} W`;
  if (sport !== "bike" && s?.threshold_pace) {
    const secs = PER[sport].metres / s.threshold_pace;
    if (secs > 30 && secs < 900) typed = `${fmtSecs(secs)}${PER[sport].unit}`;
  }
  if (!typed || (measured && measured.endsWith(typed))) return null;
  return `Not used: ${typed} typed in intervals.icu settings (not measured).`;
}

export function buildThresholds(
  athlete: Athlete | null,
  est: Estimates | null,
  maxHr: { value: number; basis: string } | null = null,
  restHr: { value: number; basis: string } | null = null,
): Thresholds {
  const notes: string[] = [];
  const hr = maxHr ? heartZones(maxHr.value, restHr?.value ?? null) : [];
  const heartBasis = !maxHr
    ? "No heart rate data yet"
    : restHr
      ? `${maxHr.basis}; resting HR ${Math.round(restHr.value)} bpm (${restHr.basis}); zones are % of heart rate reserve (max minus resting)`
      : `${maxHr.basis}; zones are % of max HR until there is a resting HR`;
  const out = {} as Thresholds;

  for (const sport of ["bike", "run", "swim"] as const) {
    const s = settingsFor(athlete, sport);
    const e = est?.[sport === "bike" ? "ftp" : sport] ?? null;
    const threshold = e ? (sport === "bike" ? `FTP ${Math.round(e.value)} W` : `${fmtSecs(e.value)}${PER[sport].unit}`) : null;
    out[sport] = {
      threshold,
      threshold_source: e ? "estimate" : null,
      threshold_basis: e?.basis ?? null,
      missing: e ? null : MISSING[sport],
      ignored: ignoredText(sport, s, threshold),
      indoor_ftp: null,
      lthr: null,
      max_hr: maxHr?.value ?? null,
      hr_zones: hr,
      work_zones: e ? (sport === "bike" ? powerZones(s, e.value) : paceZones(s, sport, e.value)) : [],
    };
  }
  if (!maxHr) notes.push("Heart rate zones need a few sessions recorded with heart rate.");
  out.notes = notes;
  out.heart = { max_hr: maxHr?.value ?? null, basis: heartBasis, zones: hr };
  return out;
}

// ---------- typical values over the last 6 weeks ----------

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  return v.length ? Math.round(quantile(v, 0.5) * 10) / 10 : null;
}

function paceStats(acts: ActivitySummary[], sport: "swim" | "run") {
  const per = PER[sport].metres;
  const secs = acts
    .filter((a) => a.minutes && a.distance_km && a.distance_km > 0)
    .map((a) => (a.minutes! * 60) / ((a.distance_km! * 1000) / per))
    .sort((a, b) => a - b);
  if (secs.length === 0) return { median_pace: null, middle_half: null };
  const unit = PER[sport].unit;
  return {
    median_pace: `${fmtSecs(quantile(secs, 0.5))}${unit}`,
    middle_half: secs.length >= 4 ? `${fmtSecs(quantile(secs, 0.25))} to ${fmtSecs(quantile(secs, 0.75))}${unit}` : null,
  };
}

export function typicalValues(activities: ActivitySummary[], date: string, days = 42): Typical {
  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
  const inWindow = activities.filter((a) => a.date >= from && a.date <= date);
  const pick = (sport: Sport) => inWindow.filter((a) => a.sport === sport);
  const base = (acts: ActivitySummary[]) => ({
    sessions: acts.length,
    median_minutes: median(acts.map((a) => a.minutes)),
    median_distance_km: median(acts.map((a) => a.distance_km)),
    median_avg_hr: median(acts.map((a) => a.avg_hr)),
  });
  const swim = pick("swim");
  const run = pick("run");
  const bike = pick("bike");
  return {
    days,
    swim: { ...base(swim), ...paceStats(swim, "swim"), median_avg_watts: null },
    run: { ...base(run), ...paceStats(run, "run"), median_avg_watts: null },
    bike: { ...base(bike), median_pace: null, middle_half: null, median_avg_watts: median(bike.map((a) => a.avg_watts)) },
  };
}
