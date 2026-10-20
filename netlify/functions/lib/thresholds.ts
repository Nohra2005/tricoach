// The athlete's own numbers: thresholds and zones from intervals.icu sport settings
// (overridden by anything filled in on the Settings screen), and typical values from the
// last 6 weeks of sessions. Pure functions, no network.
import type { ActivitySummary, Settings, Thresholds, Typical } from "../../../shared/schemas";
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
// Plausible threshold speeds in m/s; anything outside is ignored rather than guessed at.
const SPEED_RANGE: Record<"swim" | "run", [number, number]> = { swim: [0.4, 2.5], run: [1.5, 7] };

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

// "Z2 Endurance", or just "Z2" when intervals.icu has no name for the zone.
function zoneLabel(i: number, name: string | undefined): string {
  return name ? `Z${i + 1} ${name}` : `Z${i + 1}`;
}

function hrZones(s: SportSettings | null): string[] {
  if (!s || s.hr_zones.length === 0) return [];
  return s.hr_zones.map((upper, i) => {
    const name = zoneLabel(i, s.hr_zone_names[i]);
    const from = i === 0 ? null : s.hr_zones[i - 1] + 1;
    return from === null ? `${name}: up to ${upper} bpm` : `${name}: ${from} to ${upper} bpm`;
  });
}

function powerZones(s: SportSettings | null, ftp: number | null): string[] {
  if (!s || s.power_zones.length === 0) return [];
  return s.power_zones.map((upper, i) => {
    const name = zoneLabel(i, s.power_zone_names[i]);
    const from = i === 0 ? 0 : s.power_zones[i - 1];
    const w = (pct: number) => (ftp ? ` (${Math.round((pct * ftp) / 100)} W)` : "");
    if (upper >= 500) return `${name}: above ${from}% FTP${w(from)}`;
    return `${name}: ${from} to ${upper}% FTP${ftp ? ` (${Math.round((from * ftp) / 100)} to ${Math.round((upper * ftp) / 100)} W)` : ""}`;
  });
}

// pace_zones are % of threshold speed; a higher % is faster.
function paceZones(s: SportSettings | null, sport: "swim" | "run", thresholdSecs: number | null): string[] {
  if (!s || s.pace_zones.length === 0 || !thresholdSecs) return [];
  const { unit } = PER[sport];
  const pace = (pct: number) => fmtSecs(thresholdSecs / (pct / 100));
  return s.pace_zones.map((upper, i) => {
    const name = zoneLabel(i, s.pace_zone_names[i]);
    const from = i === 0 ? 0 : s.pace_zones[i - 1];
    if (from === 0) return `${name}: slower than ${pace(upper)}${unit}`;
    if (upper >= 500) return `${name}: faster than ${pace(from)}${unit}`;
    return `${name}: ${pace(from)} to ${pace(upper)}${unit}`;
  });
}

function speedToSecs(sport: "swim" | "run", speed: number | null): number | null {
  if (speed === null) return null;
  const [lo, hi] = SPEED_RANGE[sport];
  if (speed < lo || speed > hi) return null;
  return PER[sport].metres / speed;
}

// Priority: an estimate from the athlete's own sessions, then a value typed into TriCoach
// Settings, then the value in intervals.icu settings.
export function buildThresholds(athlete: Athlete | null, plan: Settings["plan"], est: Estimates | null = null): Thresholds {
  const notes: string[] = [];
  const out = {} as Thresholds;

  // Bike: FTP
  const bs = settingsFor(athlete, "bike");
  const icuFtp = bs?.ftp ?? null;
  const estFtp = est?.ftp ?? null;
  const ftp = estFtp?.value ?? plan.ftp_watts ?? icuFtp;
  const manualFtp = plan.ftp_watts ?? icuFtp;
  if (estFtp && manualFtp && Math.abs(estFtp.value - manualFtp) >= 5) {
    notes.push(`Using estimated FTP ${estFtp.value} W instead of the ${manualFtp} W typed in ${plan.ftp_watts ? "TriCoach" : "intervals.icu"} settings.`);
  }
  out.bike = {
    threshold: ftp ? `FTP ${ftp} W` : null,
    threshold_source: estFtp ? "estimate" : plan.ftp_watts ? "settings" : icuFtp ? "intervals.icu" : null,
    threshold_basis: estFtp?.basis ?? null,
    indoor_ftp: bs?.indoor_ftp ?? null,
    lthr: bs?.lthr ?? null,
    max_hr: bs?.max_hr ?? null,
    hr_zones: hrZones(bs),
    work_zones: powerZones(bs, ftp),
  };

  // Swim and run: threshold pace
  for (const sport of ["swim", "run"] as const) {
    const s = settingsFor(athlete, sport);
    const icuSecs = speedToSecs(sport, s?.threshold_pace ?? null);
    if (s?.threshold_pace && icuSecs === null) {
      notes.push(`Ignored intervals.icu ${sport} threshold pace value ${s.threshold_pace} (outside the expected range).`);
    }
    const typed = sport === "swim" ? plan.swim_css : plan.threshold_run_pace;
    const typedSecs = typed ? parsePace(typed) : null;
    const estimate = est?.[sport] ?? null;
    const secs = estimate?.value ?? typedSecs ?? icuSecs;
    const manual = typedSecs ?? icuSecs;
    if (estimate && manual && Math.abs(estimate.value - manual) >= 3) {
      notes.push(
        `Using estimated ${sport} threshold ${fmtSecs(estimate.value)}${PER[sport].unit} instead of the ${fmtSecs(manual)}${PER[sport].unit} typed in ${typedSecs ? "TriCoach" : "intervals.icu"} settings.`,
      );
    }
    out[sport] = {
      threshold: secs ? `${fmtSecs(secs)}${PER[sport].unit}` : null,
      threshold_source: estimate ? "estimate" : typedSecs ? "settings" : icuSecs ? "intervals.icu" : null,
      threshold_basis: estimate?.basis ?? null,
      indoor_ftp: null,
      lthr: s?.lthr ?? null,
      max_hr: s?.max_hr ?? null,
      hr_zones: hrZones(s),
      work_zones: paceZones(s, sport, secs),
    };
  }

  if (!athlete) notes.push("Could not read sport settings from intervals.icu; only TriCoach settings are used.");
  out.notes = notes;
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
