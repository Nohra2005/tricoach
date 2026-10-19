// Typed intervals.icu client.
// Verified against the OpenAPI spec at https://intervals.icu/api/v1/docs (linked from
// https://intervals.icu/api-docs.html):
//   base URL      https://intervals.icu/api/v1
//   auth          HTTP Basic, username "API_KEY", password = API key
//   wellness      GET /athlete/{id}/wellness?oldest=YYYY-MM-DD&newest=YYYY-MM-DD   -> Wellness[]
//   activities    GET /athlete/{id}/activities?oldest=...&newest=...  (oldest required, newest first)
//   athlete       GET /athlete/{id}
// Every field is optional in practice; missing or null values become null, never 0.
import { z } from "zod";
import type { ActivitySummary } from "../../../shared/schemas";
import { HttpError, env } from "./http";
import { addDays } from "./dates";

const BASE = "https://intervals.icu/api/v1";

const num = z.number().nullish().transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
const str = z.string().nullish().transform((v) => v ?? null);
const bool = z.boolean().nullish().transform((v) => v ?? null);

export const WellnessSchema = z.looseObject({
  id: z.string(), // the day, YYYY-MM-DD
  ctl: num,
  atl: num,
  rampRate: num,
  weight: num,
  restingHR: num,
  hrv: num,
  hrvSDNN: num,
  sleepSecs: num,
  sleepScore: num,
  sleepQuality: num,
  avgSleepingHR: num,
  readiness: num,
  soreness: num,
  fatigue: num,
  stress: num,
  mood: num,
  motivation: num,
});
export type Wellness = z.infer<typeof WellnessSchema>;

export const ActivitySchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  start_date_local: z.string(),
  type: str,
  name: str,
  moving_time: num,
  elapsed_time: num,
  distance: num,
  icu_training_load: num,
  icu_intensity: num,
  average_heartrate: num,
  icu_average_watts: num,
  icu_weighted_avg_watts: num,
  trainer: bool,
  pool_length: num,
  icu_rpe: num,
  perceived_exertion: num,
});
export type Activity = z.infer<typeof ActivitySchema>;

// Activities that came from Strava are returned as stubs with a `_note` and no data.
const HiddenActivitySchema = z.looseObject({ id: z.unknown(), _note: z.string() });

export const AthleteSchema = z.looseObject({ id: z.string(), name: str });

function authHeader(): string {
  return "Basic " + Buffer.from(`API_KEY:${env("INTERVALS_API_KEY")}`).toString("base64");
}

async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${BASE}/athlete/${encodeURIComponent(env("INTERVALS_ATHLETE_ID"))}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: authHeader(), accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
  } catch (e) {
    throw new HttpError(502, `intervals.icu did not respond (${e instanceof Error ? e.message : e})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, `intervals.icu rejected the API key or athlete ID (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new HttpError(502, `intervals.icu error HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function parseArray<T>(schema: z.ZodType<T>, data: unknown, what: string): T[] {
  if (!Array.isArray(data)) throw new HttpError(502, `intervals.icu returned non-array for ${what}`);
  const out: T[] = [];
  for (const item of data) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else console.warn(`Skipping unparseable ${what} record`, r.error.issues.slice(0, 3));
  }
  return out;
}

export async function getAthlete() {
  return AthleteSchema.parse(await get(""));
}

export async function getWellness(oldest: string, newest: string): Promise<Wellness[]> {
  const data = await get("/wellness", { oldest, newest });
  return parseArray(WellnessSchema, data, "wellness").sort((a, b) => a.id.localeCompare(b.id));
}

export interface ActivitiesResult {
  activities: Activity[];
  hidden: number;
  raw: unknown[];
}

// newest is inclusive of that whole day: we ask for one extra day and filter by local date.
export async function getActivities(oldest: string, newest: string): Promise<ActivitiesResult> {
  const data = await get("/activities", { oldest, newest: addDays(newest, 1) });
  const raw = Array.isArray(data) ? data : [];
  const visible = raw.filter((a) => !HiddenActivitySchema.safeParse(a).success);
  const activities = parseArray(ActivitySchema, visible, "activity").filter((a) => {
    const d = a.start_date_local.slice(0, 10);
    return d >= oldest && d <= newest;
  });
  return { activities, hidden: raw.length - visible.length, raw };
}

// ---------- normalisation ----------

const SPORT_BY_TYPE: Record<string, ActivitySummary["sport"]> = {
  Swim: "swim",
  OpenWaterSwim: "swim",
  Ride: "bike",
  VirtualRide: "bike",
  GravelRide: "bike",
  MountainBikeRide: "bike",
  EBikeRide: "bike",
  TrackRide: "bike",
  Run: "run",
  TrailRun: "run",
  VirtualRun: "run",
  TrackRun: "run",
};

export function sportOf(type: string | null): ActivitySummary["sport"] {
  return (type && SPORT_BY_TYPE[type]) || "other";
}

// A session counts as "hard" if intervals.icu intensity (IF x 100) is 85 or more,
// or the recorded RPE is 8 or more. Shown to Claude and in the UI as this rule.
export const HARD_RULE = "intensity >= 85% (intervals.icu IF) or RPE >= 8";

function fmtPace(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

export function summarise(a: Activity): ActivitySummary {
  const sport = sportOf(a.type);
  const secs = a.moving_time ?? a.elapsed_time;
  const dist = a.distance;
  const rpe = a.icu_rpe ?? a.perceived_exertion;
  const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  const pace = (per: number) => (secs && dist && dist > 0 ? fmtPace(secs / (dist / per)) : null);
  return {
    id: a.id,
    date: a.start_date_local.slice(0, 10),
    start_local: a.start_date_local,
    type: a.type ?? "Unknown",
    sport,
    name: a.name,
    minutes: secs === null ? null : Math.round(secs / 60),
    distance_km: dist === null ? null : Math.round(dist / 10) / 100,
    load: a.icu_training_load,
    intensity_pct: round1(a.icu_intensity),
    avg_hr: a.average_heartrate,
    avg_watts: a.icu_average_watts,
    weighted_watts: a.icu_weighted_avg_watts,
    pace_per_100m: sport === "swim" ? pace(100) : null,
    pace_per_km: sport === "run" ? pace(1000) : null,
    trainer: a.trainer,
    rpe,
    hard: (a.icu_intensity ?? 0) >= 85 || (rpe ?? 0) >= 8,
  };
}
