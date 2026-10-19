// GET /api/health : checks env vars, the intervals.icu key and the AI provider key, and reports
// which data fields came back. Without the passcode it only reports which env vars are set.
import type { Config } from "@netlify/functions";
import { requireUser } from "./lib/auth";
import { configuredUsers } from "./lib/users";
import { handle, json } from "./lib/http";
import { getActivities, getAthlete, getWellness } from "./lib/intervals";
import { addDays } from "./lib/dates";
import { provider } from "./lib/generator";
import { PROMPT_VERSION } from "./lib/coach-prompt";

const ENV = [
  "APP_PASSCODE",
  "APP_USER_NAME",
  "INTERVALS_API_KEY",
  "INTERVALS_ATHLETE_ID",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "DEMO_DAILY_LIMIT",
  ...[2, 3, 4, 5].flatMap((n) => [`USER${n}_NAME`, `USER${n}_PASSCODE`, `USER${n}_INTERVALS_API_KEY`, `USER${n}_INTERVALS_ATHLETE_ID`]),
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
  // Booleans only: which variables are set, never their values. Unset optional ones are left out.
  const env = Object.fromEntries(ENV.filter((k) => !/^USER[2-5]_/.test(k) || process.env[k]).map((k) => [k, Boolean(process.env[k])]));
  const passcodes = configuredUsers().map((u) => u.passcode);
  const duplicatePasscodes = new Set(passcodes).size !== passcodes.length;
  let user;
  try {
    user = requireUser(req);
  } catch {
    return json({
      authenticated: false,
      env,
      accounts: configuredUsers().length,
      ...(duplicatePasscodes ? { warning: "Two accounts have the same passcode; only the first will be reachable." } : {}),
      note: "Send the passcode header to run the API checks.",
    });
  }

  const today = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const [athlete, wellness, activities, ai] = await Promise.all([
    check(async () => {
      const a = await getAthlete();
      return {
        id: a.id,
        name: a.name,
        // Raw values, so threshold units can be checked (threshold_pace is m/s).
        sport_settings: a.sportSettings.map((x) => ({
          types: x.types,
          ftp: x.ftp,
          lthr: x.lthr,
          max_hr: x.max_hr,
          threshold_pace: x.threshold_pace,
          pace_units: x.pace_units,
          hr_zones: x.hr_zones.length,
          power_zones: x.power_zones.length,
          pace_zones: x.pace_zones.length,
        })),
      };
    }),
    check(async () => {
      const rows = await getWellness(addDays(today, -6), today);
      const keys = ["hrv", "restingHR", "sleepSecs", "sleepScore", "ctl", "atl"] as const;
      const todayRow = rows.find((r) => r.id === today) ?? null;
      const lastDateWith = (k: (typeof keys)[number]) =>
        [...rows].reverse().find((r) => r[k] !== null && r.id <= today)?.id ?? "none in last 7 days";
      return {
        // Is this morning's data in intervals.icu yet?
        today: todayRow
          ? Object.fromEntries(keys.map((k) => [k, todayRow[k] ?? "no data"]))
          : "intervals.icu has no wellness record for today yet",
        last_date_with_data: Object.fromEntries(keys.map((k) => [k, lastDateWith(k)])),
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

  return json({ authenticated: true, account: { id: user.id, name: user.name, kind: user.kind }, env, date: today, prompt_version: PROMPT_VERSION, intervals: { athlete, wellness, activities }, ai });
});

export const config: Config = { path: "/api/health" };
