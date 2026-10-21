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
import { HttpError } from "./http";
import { currentUser } from "./users";
import { demoApi } from "./demo";
import { PaceCurveSet } from "./estimates";
import { addDays } from "./dates";

// INTERVALS_BASE_URL is only for local testing against scripts/mock-apis.mjs.
const BASE = process.env.INTERVALS_BASE_URL || "https://intervals.icu/api/v1";

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
  max_heartrate: num,
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

const numArray = z
  .array(z.number().nullable())
  .nullish()
  .transform((v) => (v ?? []).filter((x): x is number => typeof x === "number" && Number.isFinite(x)));
const strArray = z
  .array(z.string().nullable())
  .nullish()
  .transform((v) => (v ?? []).map((x) => x ?? ""));

// One entry per sport group in intervals.icu Settings (types like ["Ride", "VirtualRide"]).
// hr_zones are bpm upper bounds, power_zones are % of FTP upper bounds, pace_zones are
// % of threshold speed upper bounds, threshold_pace is a speed in m/s.
export const SportSettingsSchema = z.looseObject({
  types: z.array(z.string()).nullish().transform((v) => v ?? []),
  ftp: num,
  indoor_ftp: num,
  lthr: num,
  max_hr: num,
  hr_zones: numArray,
  hr_zone_names: strArray,
  power_zones: numArray,
  power_zone_names: strArray,
  threshold_pace: num,
  pace_units: str,
  pace_zones: numArray,
  pace_zone_names: strArray,
});
export type SportSettings = z.infer<typeof SportSettingsSchema>;

export const AthleteSchema = z.looseObject({
  id: z.string(),
  name: str,
  icu_resting_hr: num,
  sportSettings: z
    .array(z.unknown())
    .nullish()
    .transform((v) =>
      (v ?? []).flatMap((s) => {
        const r = SportSettingsSchema.safeParse(s);
        return r.success ? [r.data] : [];
      }),
    ),
});
export type Athlete = z.infer<typeof AthleteSchema>;

// Credentials come from the current account (users.ts). The demo never calls intervals.icu.
function credentials() {
  const user = currentUser();
  if (!user.intervals) {
    throw new HttpError(500, `No intervals.icu API key or athlete ID is set for ${user.name}`);
  }
  return user.intervals;
}

async function call(method: "GET" | "POST", path: string, params: Record<string, string> = {}, body?: unknown): Promise<unknown> {
  if (currentUser().kind === "demo") {
    if (method !== "GET") throw new HttpError(403, "The demo does not write to intervals.icu");
    return demoApi(path, params);
  }
  const { apiKey, athleteId } = credentials();
  const url = new URL(`${BASE}/athlete/${encodeURIComponent(athleteId)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64"),
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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

const get = (path: string, params: Record<string, string> = {}) => call("GET", path, params);

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

// POST /athlete/{id}/events?upsertOnUid=true : creates a planned workout on the calendar,
// or replaces the one with the same uid. intervals.icu parses the description (workout
// builder text) into workout_doc and, if enabled in its Garmin settings, sends it to
// Garmin Connect.
export const EventResponse = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  workout_doc: z.unknown().optional(),
});

export interface PlannedWorkout {
  uid: string;
  date: string;
  type: string;
  name: string;
  description: string;
  moving_time: number;
  indoor: boolean;
}

export async function upsertWorkout(w: PlannedWorkout) {
  const data = await call(
    "POST",
    "/events",
    { upsertOnUid: "true" },
    {
      category: "WORKOUT",
      start_date_local: `${w.date}T00:00:00`,
      type: w.type,
      name: w.name,
      description: w.description,
      moving_time: w.moving_time,
      indoor: w.indoor,
      uid: w.uid,
    },
  );
  return EventResponse.parse(data);
}

// GET /athlete/{id}/events/{eventId} : used to read back workout_doc after a create.
export async function getEvent(id: string) {
  return EventResponse.parse(await get(`/events/${encodeURIComponent(id)}`));
}

// GET /athlete/{id}/pace-curves?type=Run&newest=YYYY-MM-DD&curves=84d : best time per
// distance over a window, plus intervals.icu's critical speed model. If the window format
// is not accepted, falls back to the default curve (the last year).
export async function getPaceCurve(type: "Run" | "Swim", date: string, days: number): Promise<PaceCurveSet | null> {
  const params = { type, newest: date, now: date };
  try {
    const set = PaceCurveSet.parse(await get("/pace-curves", { ...params, curves: `${days}d` }));
    if (set.list.length) return set;
  } catch (e) {
    console.warn(`pace curve with curves=${days}d failed`, e);
  }
  try {
    const set = PaceCurveSet.parse(await get("/pace-curves", params));
    return set.list.length ? set : null;
  } catch (e) {
    console.warn("pace curve failed", e);
    return null;
  }
}

// Max HR of every session in the last year, for heart rate zones from data. Asks only
// for the fields it needs; falls back to full records if that parameter is refused.
// Each session's max HR with its average HR, so a real max from a hard session can be
// told apart from a sensor spike in an easy one.
export async function getMaxHeartRates(date: string): Promise<{ max: number; avg: number | null }[]> {
  const params = { oldest: addDays(date, -365), newest: addDays(date, 1) };
  let data: unknown;
  try {
    data = await get("/activities", { ...params, fields: "id,start_date_local,type,max_heartrate,average_heartrate" });
  } catch {
    data = await get("/activities", params);
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((r) => {
    const o = r && typeof r === "object" ? (r as { max_heartrate?: unknown; average_heartrate?: unknown }) : {};
    if (typeof o.max_heartrate !== "number") return [];
    return [{ max: o.max_heartrate, avg: typeof o.average_heartrate === "number" ? o.average_heartrate : null }];
  });
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
// or the recorded RPE is 8 or more. Shown to the model and in the UI as this rule.
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
    max_hr: a.max_heartrate,
    pool_length: sport === "swim" ? a.pool_length : null,
  };
}
