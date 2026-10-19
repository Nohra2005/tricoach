// The public demo: a made-up athlete with six weeks of generated data, returned in the
// same shape as the intervals.icu API so the real metrics, AI and rule code all run on it.
// Nothing here touches a real account.
import type { CheckIn, Plan, Settings } from "../../../shared/schemas";
import { addDays, weekday } from "./dates";

// Small deterministic random generator, so a visitor sees the same numbers all day.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

export function demoWellness(oldest: string, newest: string) {
  const rows = [];
  for (let d = oldest, i = 0; d <= newest; d = addDays(d, 1), i++) {
    const r = rng(`w${d}`);
    const wave = Math.sin(i / 4);
    rows.push({
      id: d,
      hrv: round(58 + wave * 4 + (r() - 0.5) * 10),
      restingHR: round(49 - wave + (r() - 0.5) * 3),
      sleepSecs: round((7.2 + (r() - 0.5) * 1.6) * 3600),
      sleepScore: round(70 + r() * 20),
      ctl: round(46 + (i % 42) * 0.15, 1),
      atl: round(50 + wave * 8 + r() * 4, 1),
      readiness: round(55 + wave * 15 + r() * 15),
      weight: 61.5,
    });
  }
  return rows;
}

// Weekly pattern: Mon swim, Tue indoor bike, Wed swim, Thu group run, Fri rest,
// Sat long ride, Sun long run. Sessions are only generated for days before "today".
const WEEK: Record<string, { type: string; min: number; km: number; load: number; intensity: number; watts?: number; trainer?: boolean } | null> = {
  Monday: { type: "Swim", min: 45, km: 2, load: 35, intensity: 70 },
  Tuesday: { type: "VirtualRide", min: 60, km: 28, load: 60, intensity: 78, watts: 160, trainer: true },
  Wednesday: { type: "Swim", min: 40, km: 1.8, load: 30, intensity: 68 },
  Thursday: { type: "Run", min: 50, km: 9, load: 62, intensity: 87 },
  Friday: null,
  Saturday: { type: "Ride", min: 120, km: 55, load: 110, intensity: 72, watts: 145 },
  Sunday: { type: "Run", min: 70, km: 12, load: 70, intensity: 75 },
};

export function demoActivities(oldest: string, newest: string, today: string) {
  const out = [];
  for (let d = oldest; d <= newest && d < today; d = addDays(d, 1)) {
    const s = WEEK[weekday(d)];
    const r = rng(`a${d}`);
    if (!s || r() < 0.1) continue; // about one session in ten skipped, like real life
    const f = 0.9 + r() * 0.2;
    out.push({
      id: `demo-${d}`,
      start_date_local: `${d}T07:${String(Math.floor(r() * 50) + 10)}:00`,
      type: s.type,
      name: `${s.type === "VirtualRide" ? "Trainer ride" : s.type} (demo)`,
      moving_time: round(s.min * 60 * f),
      distance: round(s.km * 1000 * f),
      icu_training_load: round(s.load * f),
      icu_intensity: round(s.intensity + (r() - 0.5) * 4, 1),
      average_heartrate: round(135 + (s.intensity - 70) * 1.5 + r() * 6),
      icu_average_watts: s.watts ? round(s.watts * f) : null,
      trainer: s.trainer ?? false,
      pool_length: s.type === "Swim" ? 25 : null,
    });
  }
  return out;
}

export const DEMO_ATHLETE = {
  id: "demo",
  name: "Demo athlete",
  sportSettings: [
    {
      types: ["Ride", "VirtualRide"],
      ftp: 210,
      lthr: 170,
      max_hr: 192,
      hr_zones: [138, 151, 158, 165, 171, 176, 192],
      hr_zone_names: ["Recovery", "Aerobic", "Tempo", "SubThreshold", "SuperThreshold", "Aerobic Capacity", "Anaerobic"],
      power_zones: [55, 75, 90, 105, 120, 150, 999],
      power_zone_names: ["Active Recovery", "Endurance", "Tempo", "Threshold", "VO2 Max", "Anaerobic", "Neuromuscular"],
    },
    {
      types: ["Run", "TrailRun"],
      lthr: 175,
      max_hr: 192,
      threshold_pace: 3.448, // 4:50/km
      pace_units: "MINS_KM",
      hr_zones: [142, 155, 162, 170, 176, 182, 192],
      pace_zones: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999],
    },
    { types: ["Swim"], threshold_pace: 0.833, pace_units: "SECS_100M" }, // 2:00/100m
  ],
};

// Stand-in for the intervals.icu API: same paths, same response shapes.
// getActivities asks for one day past the requested date, so "today" is newest - 1.
export function demoApi(path: string, params: Record<string, string>): unknown {
  if (path === "") return DEMO_ATHLETE;
  if (path === "/wellness") return demoWellness(params.oldest, params.newest);
  if (path === "/activities") return demoActivities(params.oldest, params.newest, addDays(params.newest, -1));
  if (path.startsWith("/events/")) return { id: path.split("/").pop() };
  return [];
}

export const DEMO_SETTINGS: Settings = {
  profile: {
    name: "Demo athlete",
    history: "Has finished an Olympic distance and a half Ironman (70.3).",
    swim: "25 m pool, 2 to 3 times a week. Comfortable aerobic pace about 2:10/100m. Working on a longer, calmer stroke.",
    bike: "Indoor smart trainer on weekdays, long outdoor ride on Saturdays.",
    run: "Group run on Thursdays; long easy run on Sundays. Easy pace about 6:00/km.",
    life: "Works full time, so weekday sessions are 45 to 75 minutes.",
    other_notes: "This is a made-up athlete for the TriCoach demo.",
  },
  plan: {
    goal_race: "Demo 70.3",
    goal_race_date: "",
    ftp_watts: null,
    threshold_run_pace: "",
    swim_css: "",
    max_hard_per_week: 2,
    usual_swim_days: ["Monday", "Wednesday"],
    set_sessions: [{ weekday: "Thursday", time: "18:00", sport: "run", description: "Group run, 8 to 10 km" }],
    focus: "Aerobic base",
  },
};

// Used when the demo's daily limit for live AI sessions is reached: a fixed template that
// respects the check-in (time, place, pain), clearly labelled as a sample.
export function demoSamplePlan(c: CheckIn): Plan {
  const easyDay = c.pain !== null || c.energy <= 2 || c.soreness >= 4;
  const intensity = easyDay ? "recovery" : "easy";
  const why =
    "This is a fixed demo sample: today's limit for live AI sessions in the public demo has been reached. " +
    "In a real account every session is written by the AI from the athlete's own data and check-in.";
  const none = { kind: "none" as const, low: null, high: null };
  if (c.minutes < 20 || c.locations.includes("none") || (c.pain !== null && /chest|fever|ill|flu|covid/i.test(c.pain))) {
    return { sport: "rest", title: "Rest day (demo sample)", total_minutes: 0, intensity: "rest", steps: [], why, easier_option: "Rest.", warnings: c.pain ? ["See a doctor if the symptoms continue."] : [] };
  }
  const m = Math.min(c.minutes, 60);
  if (c.locations.includes("pool")) {
    return {
      sport: "swim",
      title: "Easy aerobic swim (demo sample)",
      total_minutes: Math.min(m, 45),
      intensity,
      steps: [
        { label: "Warm-up", minutes: null, distance_m: 300, target: "Easy, RPE 3", target_spec: { kind: "rpe", low: 3, high: 3 }, reps: null, rest_seconds: null, notes: null },
        { label: "Main set", minutes: null, distance_m: 100, target: "2:15 to 2:20/100m", target_spec: { kind: "pace", low: 135, high: 140 }, reps: 6, rest_seconds: 20, notes: "20 s rest" },
        { label: "Cool-down", minutes: null, distance_m: 200, target: "Easy", target_spec: none, reps: null, rest_seconds: null, notes: null },
      ],
      why,
      easier_option: "Swim 600 m easy and stop.",
      warnings: [],
    };
  }
  const main = Math.max(5, m - 15);
  if (c.locations.includes("indoor_trainer") || c.locations.includes("outdoor_bike")) {
    return {
      sport: "bike",
      title: "Endurance ride (demo sample)",
      total_minutes: m,
      intensity,
      steps: [
        { label: "Warm-up", minutes: 10, distance_m: null, target: "Z1 to Z2 HR", target_spec: { kind: "hr_zone", low: 1, high: 2 }, reps: null, rest_seconds: null, notes: null },
        { label: "Steady", minutes: main, distance_m: null, target: "60 to 70% FTP", target_spec: { kind: "power_pct_ftp", low: 60, high: 70 }, reps: null, rest_seconds: null, notes: null },
        { label: "Cool-down", minutes: 5, distance_m: null, target: "Easy spin", target_spec: { kind: "power_pct_ftp", low: 45, high: 55 }, reps: null, rest_seconds: null, notes: null },
      ],
      why,
      easier_option: "Ride 30 minutes in Z1.",
      warnings: [],
    };
  }
  if (c.locations.includes("run")) {
    return {
      sport: "run",
      title: "Easy run (demo sample)",
      total_minutes: m,
      intensity,
      steps: [
        { label: "Warm-up", minutes: 10, distance_m: null, target: "Z1 HR", target_spec: { kind: "hr_zone", low: 1, high: 1 }, reps: null, rest_seconds: null, notes: null },
        { label: "Easy", minutes: main, distance_m: null, target: "Z2 HR", target_spec: { kind: "hr_zone", low: 2, high: 2 }, reps: null, rest_seconds: null, notes: null },
        { label: "Walk", minutes: 5, distance_m: null, target: "Easy", target_spec: none, reps: null, rest_seconds: null, notes: null },
      ],
      why,
      easier_option: "Run 20 minutes easy.",
      warnings: [],
    };
  }
  return {
    sport: "mobility",
    title: "Mobility (demo sample)",
    total_minutes: Math.min(m, 30),
    intensity: "recovery",
    steps: [{ label: "Mobility circuit", minutes: Math.min(m, 30), distance_m: null, target: "Gentle", target_spec: none, reps: null, rest_seconds: null, notes: null }],
    why,
    easier_option: "10 minutes of stretching.",
    warnings: [],
  };
}
