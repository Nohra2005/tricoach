// Matches a day's plan to the activity actually recorded in intervals.icu.
import type { ActivitySummary, DayRecord } from "../../../shared/schemas";

const COMPATIBLE: Record<string, ActivitySummary["sport"][]> = {
  swim: ["swim"],
  bike: ["bike"],
  run: ["run"],
  brick: ["bike", "run"],
  strength: ["other"],
  mobility: ["other"],
  rest: [],
};

export function matchActivity(day: DayRecord, activities: ActivitySummary[]): DayRecord["matched_activity"] {
  const sameDay = activities.filter((a) => a.date === day.date);
  if (sameDay.length === 0) return null;
  const longest = (xs: ActivitySummary[]) => [...xs].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0];
  const sport = day.plan?.sport ?? "rest";
  const compatible = sameDay.filter((a) => COMPATIBLE[sport].includes(a.sport));
  if (compatible.length) {
    return { ...longest(compatible), match_rule: `same date, sport compatible with "${sport}", longest of ${compatible.length}` };
  }
  return { ...longest(sameDay), match_rule: `same date, different sport than planned "${sport}", longest of ${sameDay.length}` };
}
