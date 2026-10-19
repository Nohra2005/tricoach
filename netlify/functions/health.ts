// GET /api/health : checks env vars, the intervals.icu key and the AI provider key, and reports
// which data fields came back. Without the passcode it only reports which env vars are set.
import type { Config } from "@netlify/functions";
import { requirePasscode } from "./lib/auth";
import { handle, json } from "./lib/http";
import { getActivities, getAthlete, getWellness } from "./lib/intervals";
import { addDays } from "./lib/dates";
import { provider } from "./lib/generator";
import { PROMPT_VERSION } from "./lib/coach-prompt";

const ENV = [
  "INTERVALS_API_KEY",
  "INTERVALS_ATHLETE_ID",
  "APP_PASSCODE",
  "GROQ_API_KEY",
  "GROQ_MODEL",
];

function fieldCoverage(rows: Record<string, unknown>[], fields: string[]) {
  return Object.fromEntries(
    fields.map((f) => [f, `${rows.filter((r) => r[f] !== null && r[f] !== undefined).length}/${rows.length}`]),
  );
}

async function check<T>(fn: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default handle(async (req) => {
  const env = Object.fromEntries(ENV.map((k) => [k, Boolean(process.env[k])]));
  try {
    requirePasscode(req);
  } catch {
    return json({ authenticated: false, env, note: "Send the passcode header to run the API checks." });
  }

  const today = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const [athlete, wellness, activities, ai] = await Promise.all([
    check(async () => {
      const a = await getAthlete();
      return { id: a.id, name: a.name };
    }),
    check(async () => {
      const rows = await getWellness(addDays(today, -6), today);
      return {
        days_returned: rows.length,
        fields_with_data: fieldCoverage(rows, ["hrv", "restingHR", "sleepSecs", "sleepScore", "ctl", "atl", "weight", "readiness"]),
      };
    }),
    check(async () => {
      const r = await getActivities(addDays(today, -13), today);
      return {
        activities_returned: r.activities.length,
        hidden_strava_stubs: r.hidden,
        types: [...new Set(r.activities.map((a) => a.type))],
        fields_with_data: fieldCoverage(r.activities, [
          "moving_time", "distance", "icu_training_load", "icu_intensity", "average_heartrate", "icu_average_watts", "icu_rpe",
        ]),
      };
    }),
    check(async () => {
      return provider().check();
    }),
  ]);

  return json({ authenticated: true, env, date: today, prompt_version: PROMPT_VERSION, intervals: { athlete, wellness, activities }, ai });
});

export const config: Config = { path: "/api/health" };
