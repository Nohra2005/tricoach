// Netlify Blobs storage. One store, keys:
//   settings.json         athlete profile and plan settings
//   days/YYYY-MM-DD.json  one DayRecord per day
//   jobs/<uuid>.json      generation job status
import { getStore } from "@netlify/blobs";
import { DayRecord, Job, Settings } from "../../../shared/schemas";
import { DEFAULT_SETTINGS } from "./defaults";
import { weekday } from "./dates";

function store() {
  return getStore({ name: "tricoach", consistency: "strong" });
}

export function now(): string {
  return new Date().toISOString();
}

export async function getSettings(): Promise<Settings> {
  const data = await store().get("settings.json", { type: "json" });
  const parsed = Settings.safeParse(data);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function putSettings(s: Settings): Promise<void> {
  await store().setJSON("settings.json", Settings.parse(s));
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
    events: [],
  };
}

export async function getDay(date: string): Promise<DayRecord | null> {
  const data = await store().get(`days/${date}.json`, { type: "json" });
  if (data === null) return null;
  const parsed = DayRecord.safeParse(data);
  if (!parsed.success) {
    console.error(`Stored day ${date} does not match schema`, parsed.error.issues.slice(0, 5));
    return null;
  }
  return parsed.data;
}

export async function putDay(day: DayRecord): Promise<void> {
  await store().setJSON(`days/${day.date}.json`, DayRecord.parse(day));
}

export async function listDays(): Promise<DayRecord[]> {
  const { blobs } = await store().list({ prefix: "days/" });
  const days = await Promise.all(
    blobs.map((b) => getDay(b.key.replace(/^days\//, "").replace(/\.json$/, ""))),
  );
  return days.filter((d): d is DayRecord => d !== null).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getJob(id: string): Promise<Job | null> {
  const parsed = Job.safeParse(await store().get(`jobs/${id}.json`, { type: "json" }));
  return parsed.success ? parsed.data : null;
}

export async function putJob(job: Omit<Job, "updated_at">): Promise<void> {
  await store().setJSON(`jobs/${job.id}.json`, { ...job, updated_at: now() });
}
