// Storage (D1 key/value table, db.ts). Every key is prefixed with the current account's
// prefix (users.ts): "" for user 1 (so existing data stays put), "users/u2/" for user 2,
// "demo/<sandbox id>/" for a demo visitor. Keys under the prefix:
//   settings.json         athlete profile and plan settings
//   days/YYYY-MM-DD.json  one DayRecord per day
//   jobs/<uuid>.json      generation job status
// Global keys (no prefix) are only used for demo usage counters.
import { DayRecord, Job, Settings } from "../../shared/schemas";
import { BLANK_SETTINGS, DEFAULT_SETTINGS } from "./defaults";
import { DEMO_SETTINGS } from "./demo";
import { weekday } from "./dates";
import { migrateSettings } from "./settings-migrate";
import { kv } from "./db";
import { currentUser } from "./users";

function key(k: string): string {
  return currentUser().storePrefix + k;
}

export function now(): string {
  return new Date().toISOString();
}

function defaultSettings(): Settings {
  const u = currentUser();
  if (u.kind === "demo") return DEMO_SETTINGS;
  return u.id === "u1" ? DEFAULT_SETTINGS : { ...BLANK_SETTINGS, name: u.name };
}

export async function getSettings(): Promise<Settings> {
  const data = await kv.get(key("settings.json"));
  // Older free-text profiles are converted to structured preferences on read.
  return data === null ? defaultSettings() : migrateSettings(data, defaultSettings());
}

export async function putSettings(s: Settings): Promise<void> {
  await kv.set(key("settings.json"), Settings.parse(s));
}

export function emptyDay(date: string): DayRecord {
  return {
    date,
    weekday: weekday(date),
    metrics: null,
    checkin: null,
    generation: null,
    plan: null,
    previous_plans: [],
    feedback: null,
    matched_activity: null,
    match_checked_at: null,
    watch: null,
    events: [],
  };
}

export async function getDay(date: string): Promise<DayRecord | null> {
  const data = await kv.get(key(`days/${date}.json`));
  if (data === null) return null;
  const parsed = DayRecord.safeParse(data);
  if (!parsed.success) {
    console.error(`Stored day ${date} does not match schema`, parsed.error.issues.slice(0, 5));
    return null;
  }
  return parsed.data;
}

export async function putDay(day: DayRecord): Promise<void> {
  await kv.set(key(`days/${day.date}.json`), DayRecord.parse(day));
}

export async function listDays(): Promise<DayRecord[]> {
  // One query for all days. Records were validated when written; this only skips
  // anything that is not a day record at all.
  const rows = await kv.list(key("days/"));
  return rows
    .map((r) => r.value as DayRecord)
    .filter((d) => d && typeof d.date === "string" && Array.isArray(d.events))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function getJob(id: string): Promise<Job | null> {
  const parsed = Job.safeParse(await kv.get(key(`jobs/${id}.json`)));
  return parsed.success ? parsed.data : null;
}

export async function putJob(job: Omit<Job, "updated_at">): Promise<void> {
  await kv.set(key(`jobs/${job.id}.json`), { ...job, updated_at: now() });
}

// ---------- demo usage (global, not per account) ----------

// Counts live AI generations in the demo for one day, across all demo visitors.
// Not atomic; for a soft cap that is fine.
export async function demoUsageToday(date: string): Promise<number> {
  const data = (await kv.get(`demo-usage/${date}.json`)) as { count?: number } | null;
  return data?.count ?? 0;
}

export async function addDemoUsage(date: string): Promise<void> {
  const count = await demoUsageToday(date);
  await kv.set(`demo-usage/${date}.json`, { count: count + 1 });
}

// Deletes this account's own records: days, jobs and preferences. Only those prefixes,
// so account 1 (prefix "") can never touch another account's or the demo's data.
export async function deleteMyData(): Promise<number> {
  const n = (await kv.deletePrefix(key("days/"))) + (await kv.deletePrefix(key("jobs/")));
  await kv.delete(key("settings.json"));
  return n;
}
