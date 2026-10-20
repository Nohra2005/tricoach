// Turns the old free-text profile (settings before version 2) into structured
// preferences. Typed thresholds (FTP, paces) are dropped on purpose: they now come
// only from the athlete's data.
import { LegacySettings, Settings, type Weekday } from "../../../shared/schemas";
import { BLANK_SETTINGS } from "./defaults";

export function migrateSettings(raw: unknown, fallback: Settings): Settings {
  const v2 = Settings.safeParse(raw);
  if (v2.success) return v2.data;
  const old = LegacySettings.safeParse(raw);
  if (!old.success) return fallback;
  const { profile, plan } = old.data;
  const text = `${profile.history} ${profile.swim} ${profile.bike} ${profile.run}`.toLowerCase();

  const schedule = structuredClone(fallback.schedule ?? BLANK_SETTINGS.schedule);
  for (const d of plan.usual_swim_days) {
    if (d in schedule) schedule[d as Weekday].usual = "pool";
  }
  const finished: Settings["finished"] = [];
  if (/sprint/.test(text)) finished.push("sprint");
  if (/olympic/.test(text)) finished.push("olympic");
  if (/70\.3|half ironman|half-ironman/.test(text)) finished.push("70.3");
  if (/full ironman|\b140\.6\b/.test(text)) finished.push("full");

  return Settings.parse({
    ...fallback,
    name: profile.name || fallback.name,
    races: plan.goal_race ? [{ priority: "A", name: plan.goal_race.slice(0, 80), date: plan.goal_race_date.slice(0, 10), distance: "other" }] : [],
    schedule,
    fixed_sessions: plan.set_sessions.slice(0, 7),
    finished: finished.length ? finished : fallback.finished,
    equipment: { ...fallback.equipment, smart_trainer: fallback.equipment.smart_trainer || /trainer|tacx|wahoo|kickr/.test(text) },
    max_hard_per_week: plan.max_hard_per_week,
    one_sided_breathing: fallback.one_sided_breathing || /one side|bilateral/.test(text),
    coach_note: (profile.other_notes || fallback.coach_note).slice(0, 300),
  });
}
