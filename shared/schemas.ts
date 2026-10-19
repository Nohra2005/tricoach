// Schemas shared by the frontend and the Netlify functions.
import { z } from "zod";

export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// ---------- Check-in ----------

export const LOCATIONS = ["pool", "indoor_trainer", "outdoor_bike", "run", "gym", "none"] as const;
export const Location = z.enum(LOCATIONS);
export type Location = z.infer<typeof Location>;

const Scale5 = z.number().int().min(1).max(5);

export const CheckIn = z.object({
  energy: Scale5,
  soreness: Scale5,
  // No longer asked (Garmin covers stress and readiness); kept optional so older
  // check-ins still parse and export.
  motivation: Scale5.nullable().optional(),
  stress: Scale5.nullable().optional(),
  minutes: z.number().int().min(0).max(600),
  locations: z.array(Location).min(1),
  // null means "none"; a string is what the athlete wrote
  pain: z.string().trim().min(1).max(500).nullable(),
});
export type CheckIn = z.infer<typeof CheckIn>;

// ---------- Plan (model output) ----------

export const SPORTS = ["swim", "bike", "run", "brick", "strength", "mobility", "rest"] as const;
export const INTENSITIES = ["rest", "recovery", "easy", "moderate", "hard"] as const;

// Used as the structured-output schema sent to the model, so it avoids refinements and
// optional keys: every key is present, "not applicable" is null.
export const PlanStep = z.object({
  label: z.string(),
  minutes: z.number().nullable(),
  distance_m: z.number().nullable(),
  target: z.string(),
  reps: z.number().int().nullable(),
  notes: z.string().nullable(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const Plan = z.object({
  sport: z.enum(SPORTS),
  title: z.string(),
  total_minutes: z.number().int(),
  intensity: z.enum(INTENSITIES),
  steps: z.array(PlanStep),
  why: z.string(),
  easier_option: z.string(),
  warnings: z.array(z.string()),
});
export type Plan = z.infer<typeof Plan>;
export type Intensity = Plan["intensity"];

// ---------- Feedback ----------

export const Feedback = z
  .object({
    followed: z.enum(["as_planned", "modified", "skipped"]),
    reason: z.string().trim().max(1000).nullable(),
    rpe: z.number().int().min(1).max(10).nullable(),
    feel: z.number().int().min(1).max(5).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .refine((f) => f.followed === "as_planned" || (f.reason && f.reason.length > 0), {
    message: "Say why the session was modified or skipped",
    path: ["reason"],
  });
export type Feedback = z.infer<typeof Feedback>;

// ---------- Metrics ----------

export const Baseline = z.object({
  mean7: z.number().nullable(),
  mean28: z.number().nullable(),
  sd28: z.number().nullable(),
  n28: z.number().int(),
});

export const Flag = z.object({
  metric: z.string(),
  label: z.string(),
  value: z.number(),
  mean28: z.number(),
  sd28: z.number(),
  low: z.number(),
  high: z.number(),
  direction: z.enum(["below", "above"]),
  rule: z.string(),
});
export type Flag = z.infer<typeof Flag>;

export const SportTotals = z.object({
  sessions: z.number().int(),
  minutes: z.number(),
  load: z.number(),
  distance_km: z.number(),
});

export const ActivitySummary = z.object({
  id: z.string(),
  date: DateStr,
  start_local: z.string(),
  type: z.string(),
  sport: z.enum(["swim", "bike", "run", "other"]),
  name: z.string().nullable(),
  minutes: z.number().nullable(),
  distance_km: z.number().nullable(),
  load: z.number().nullable(),
  intensity_pct: z.number().nullable(),
  avg_hr: z.number().nullable(),
  avg_watts: z.number().nullable(),
  weighted_watts: z.number().nullable(),
  pace_per_100m: z.string().nullable(),
  pace_per_km: z.string().nullable(),
  trainer: z.boolean().nullable(),
  rpe: z.number().nullable(),
  hard: z.boolean(),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;

const SportThresholds = z.object({
  threshold: z.string().nullable(), // "FTP 210 W", "4:45/km", "2:05/100m"
  threshold_source: z.enum(["settings", "intervals.icu"]).nullable(),
  indoor_ftp: z.number().nullable(),
  lthr: z.number().nullable(),
  max_hr: z.number().nullable(),
  hr_zones: z.array(z.string()),
  work_zones: z.array(z.string()), // power zones for bike, pace zones for swim and run
});
export const Thresholds = z.object({
  swim: SportThresholds,
  bike: SportThresholds,
  run: SportThresholds,
  notes: z.array(z.string()),
});
export type Thresholds = z.infer<typeof Thresholds>;

const TypicalSport = z.object({
  sessions: z.number().int(),
  median_minutes: z.number().nullable(),
  median_distance_km: z.number().nullable(),
  median_avg_hr: z.number().nullable(),
  median_pace: z.string().nullable(),
  middle_half: z.string().nullable(), // 25th to 75th percentile pace
  median_avg_watts: z.number().nullable(),
});
export const Typical = z.object({ days: z.number().int(), swim: TypicalSport, bike: TypicalSport, run: TypicalSport });
export type Typical = z.infer<typeof Typical>;

const LastValue = z.object({ value: z.number(), date: DateStr }).nullable();
export const Latest = z.object({ hrv: LastValue, resting_hr: LastValue, sleep_hours: LastValue });

export const Metrics = z.object({
  date: DateStr,
  today: z.object({
    hrv: z.number().nullable(),
    resting_hr: z.number().nullable(),
    sleep_hours: z.number().nullable(),
    sleep_score: z.number().nullable(),
    ctl: z.number().nullable(),
    atl: z.number().nullable(),
    tsb: z.number().nullable(),
    weight: z.number().nullable(),
    // Garmin Training Readiness (or another device's score), if intervals.icu has it.
    readiness: z.number().nullable().optional(),
  }),
  baselines: z.object({
    hrv: Baseline,
    resting_hr: Baseline,
    sleep_hours: Baseline,
  }),
  flags: z.array(Flag),
  flag_rule: z.string(),
  last7: z.object({ swim: SportTotals, bike: SportTotals, run: SportTotals, other: SportTotals }),
  activities14: z.array(ActivitySummary),
  hidden_activities: z.number().int(),
  // Added later; optional so day records saved before still parse.
  latest: Latest.optional(), // most recent value in the last 42 days, for when today has none
  thresholds: Thresholds.nullable().optional(),
  typical: Typical.optional(),
});
export type Metrics = z.infer<typeof Metrics>;

// ---------- Settings ----------

export const SetSession = z.object({
  weekday: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  time: z.string(),
  sport: z.enum(["swim", "bike", "run", "strength"]),
  description: z.string(),
});

export const Settings = z.object({
  profile: z.object({
    name: z.string(),
    history: z.string(),
    swim: z.string(),
    bike: z.string(),
    run: z.string(),
    life: z.string(),
    other_notes: z.string(),
  }),
  plan: z.object({
    goal_race: z.string(),
    goal_race_date: z.string(),
    ftp_watts: z.number().int().positive().nullable(),
    threshold_run_pace: z.string(),
    swim_css: z.string(),
    max_hard_per_week: z.number().int().min(0).max(4),
    usual_swim_days: z.array(z.string()),
    set_sessions: z.array(SetSession),
    focus: z.string(),
  }),
});
export type Settings = z.infer<typeof Settings>;

// ---------- Day record (the research unit) ----------

export const Attempt = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  raw: z.string().nullable(),
});

export const Generation = z.object({
  provider: z.string().optional(),
  model: z.string(),
  answered_by: z.string().nullable(),
  prompt_version: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  latency_ms: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  attempts: z.array(Attempt),
  input: z.unknown(),
});

export const MatchedActivity = ActivitySummary.extend({ match_rule: z.string() });

export const DayEvent = z.object({
  at: z.string(),
  type: z.enum(["checkin", "generate", "generate_failed", "feedback", "match"]),
  detail: z.string().nullable(),
});

export const DayRecord = z.object({
  date: DateStr,
  weekday: z.string(),
  metrics: Metrics.nullable(),
  checkin: CheckIn.extend({ submitted_at: z.string() }).nullable(),
  generation: Generation.nullable(),
  plan: Plan.nullable(),
  previous_plans: z.array(z.object({ plan: Plan, replaced_at: z.string() })),
  feedback: z
    .object({
      followed: z.enum(["as_planned", "modified", "skipped"]),
      reason: z.string().nullable(),
      rpe: z.number().nullable(),
      feel: z.number().nullable(),
      notes: z.string().nullable(),
      submitted_at: z.string(),
    })
    .nullable(),
  matched_activity: MatchedActivity.nullable(),
  match_checked_at: z.string().nullable(),
  events: z.array(DayEvent),
});
export type DayRecord = z.infer<typeof DayRecord>;

export const Job = z.object({
  id: z.string(),
  date: DateStr,
  status: z.enum(["queued", "running", "done", "error"]),
  error: z.string().nullable(),
  updated_at: z.string(),
});
export type Job = z.infer<typeof Job>;

export const TodayResponse = z.object({ metrics: Metrics, day: DayRecord });
export type TodayResponse = z.infer<typeof TodayResponse>;
