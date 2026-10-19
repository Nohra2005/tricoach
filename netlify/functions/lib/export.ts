// Flattens day records into one CSV row per day (research export).
import type { DayRecord } from "../../../shared/schemas";

type Cell = string | number | boolean | null | undefined;

const COLUMNS: [string, (d: DayRecord) => Cell][] = [
  ["date", (d) => d.date],
  ["weekday", (d) => d.weekday],
  ["hrv", (d) => d.metrics?.today.hrv],
  ["hrv_mean7", (d) => d.metrics?.baselines.hrv.mean7],
  ["hrv_mean28", (d) => d.metrics?.baselines.hrv.mean28],
  ["hrv_sd28", (d) => d.metrics?.baselines.hrv.sd28],
  ["resting_hr", (d) => d.metrics?.today.resting_hr],
  ["resting_hr_mean28", (d) => d.metrics?.baselines.resting_hr.mean28],
  ["resting_hr_sd28", (d) => d.metrics?.baselines.resting_hr.sd28],
  ["sleep_hours", (d) => d.metrics?.today.sleep_hours],
  ["sleep_hours_mean28", (d) => d.metrics?.baselines.sleep_hours.mean28],
  ["sleep_score", (d) => d.metrics?.today.sleep_score],
  ["ctl", (d) => d.metrics?.today.ctl],
  ["atl", (d) => d.metrics?.today.atl],
  ["tsb", (d) => d.metrics?.today.tsb],
  ["flags", (d) => d.metrics?.flags.map((f) => `${f.metric}:${f.direction}`).join(" ")],
  ["flag_count", (d) => d.metrics?.flags.length],
  ["energy", (d) => d.checkin?.energy],
  ["soreness", (d) => d.checkin?.soreness],
  ["device_readiness", (d) => d.metrics?.today.readiness],
  ["motivation", (d) => d.checkin?.motivation],
  ["stress", (d) => d.checkin?.stress],
  ["minutes_available", (d) => d.checkin?.minutes],
  ["locations", (d) => d.checkin?.locations.join(" ")],
  ["pain", (d) => d.checkin?.pain],
  ["plan_sport", (d) => d.plan?.sport],
  ["plan_title", (d) => d.plan?.title],
  ["plan_intensity", (d) => d.plan?.intensity],
  ["plan_minutes", (d) => d.plan?.total_minutes],
  ["plan_why", (d) => d.plan?.why],
  ["plan_warnings", (d) => d.plan?.warnings.join(" | ")],
  ["replans", (d) => d.previous_plans.length],
  ["provider", (d) => d.generation?.provider],
  ["model", (d) => d.generation?.model],
  ["answered_by", (d) => d.generation?.answered_by],
  ["prompt_version", (d) => d.generation?.prompt_version],
  ["attempts", (d) => d.generation?.attempts.length],
  ["latency_ms", (d) => d.generation?.latency_ms],
  ["input_tokens", (d) => d.generation?.input_tokens],
  ["output_tokens", (d) => d.generation?.output_tokens],
  ["sent_to_watch_at", (d) => d.watch?.sent_at],
  ["sent_to_watch_steps", (d) => d.watch?.parsed_steps],
  ["followed", (d) => d.feedback?.followed],
  ["followed_reason", (d) => d.feedback?.reason],
  ["rpe", (d) => d.feedback?.rpe],
  ["feel_after", (d) => d.feedback?.feel],
  ["feedback_notes", (d) => d.feedback?.notes],
  ["actual_activity_id", (d) => d.matched_activity?.id],
  ["actual_type", (d) => d.matched_activity?.type],
  ["actual_minutes", (d) => d.matched_activity?.minutes],
  ["actual_distance_km", (d) => d.matched_activity?.distance_km],
  ["actual_load", (d) => d.matched_activity?.load],
  ["actual_intensity_pct", (d) => d.matched_activity?.intensity_pct],
  ["actual_avg_hr", (d) => d.matched_activity?.avg_hr],
  ["match_rule", (d) => d.matched_activity?.match_rule],
];

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(days: DayRecord[]): string {
  const header = COLUMNS.map(([name]) => name).join(",");
  const rows = days.map((d) => COLUMNS.map(([, get]) => cell(get(d))).join(","));
  return [header, ...rows].join("\r\n") + "\r\n";
}
