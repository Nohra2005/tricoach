// Fixtures shaped like intervals.icu responses, including days with missing fields.
import type { DayRecord } from "../shared/schemas";

export function wellnessRows(today: string, days: number, fn: (i: number) => Record<string, unknown>) {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1, d - (days - 1 - i)));
    return { id: t.toISOString().slice(0, 10), ...fn(i) };
  });
}

export const activityRaw = {
  id: "i1001",
  start_date_local: "2026-10-18T07:30:00",
  type: "Swim",
  name: "Pool swim",
  moving_time: 2700,
  elapsed_time: 3000,
  distance: 2000,
  icu_training_load: 38,
  icu_intensity: 72.4,
  average_heartrate: 138,
  icu_average_watts: null,
  trainer: false,
  pool_length: 25,
  icu_rpe: null,
};

export function emptyDayForTest(date: string): DayRecord {
  return {
    date,
    weekday: "Monday",
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
