// Hard checks on the model's plan. A violation triggers one retry with the reasons; if the
// second plan also fails, the user sees the error instead of a plan.
import type { CheckIn, Location, Plan } from "../../../shared/schemas";
import { addDays } from "./dates";

const NEEDS: Record<Plan["sport"], Location[][]> = {
  // each inner array is "one of"; all inner arrays must be satisfied
  swim: [["pool"]],
  bike: [["indoor_trainer", "outdoor_bike"]],
  run: [["run"]],
  brick: [["indoor_trainer", "outdoor_bike"], ["run"]],
  strength: [["gym"]],
  mobility: [],
  rest: [],
};

export interface RuleContext {
  date: string;
  checkin: CheckIn;
  hardDates: string[]; // days before today that counted as hard
  maxHardPerWeek: number;
  // From Settings > Preferences (optional so older callers and tests still work)
  prefs?: {
    strength: boolean;
    maxSessions: { swim: number | null; bike: number | null; run: number | null };
    oneSidedBreathing: boolean;
    noSports: ("swim" | "bike" | "run")[]; // "change this week only"
    sessionsLast6Days: { swim: number; bike: number; run: number };
  };
}

export function stepMinutes(plan: Plan): number | null {
  let total = 0;
  for (const s of plan.steps) {
    if (s.minutes === null) return null; // distance-based steps cannot be summed
    total += s.minutes * (s.reps ?? 1);
  }
  return total;
}

export function checkPlan(plan: Plan, ctx: RuleContext): string[] {
  const v: string[] = [];
  const { checkin } = ctx;

  for (const anyOf of NEEDS[plan.sport]) {
    if (!anyOf.some((loc) => checkin.locations.includes(loc))) {
      v.push(`Sport "${plan.sport}" needs one of [${anyOf.join(", ")}], but today's locations are [${checkin.locations.join(", ")}].`);
    }
  }

  if (plan.total_minutes > checkin.minutes) {
    v.push(`total_minutes is ${plan.total_minutes} but only ${checkin.minutes} minutes are available.`);
  }
  if (plan.total_minutes < 0) v.push("total_minutes cannot be negative.");

  const summed = stepMinutes(plan);
  if (summed !== null && summed > plan.total_minutes * 1.15 + 5) {
    v.push(`The steps add up to ${summed} minutes, more than total_minutes (${plan.total_minutes}).`);
  }

  for (const [i, s] of plan.steps.entries()) {
    const t = s.target_spec;
    if (t.kind !== "none") {
      const name = `Step ${i + 1} target_spec (${t.kind})`;
      if (t.low === null || t.high === null) v.push(`${name} needs both low and high.`);
      else if (t.low > t.high) v.push(`${name} has low greater than high.`);
      else {
        const [min, max] =
          t.kind === "hr_zone" ? [1, 7] : t.kind === "power_pct_ftp" ? [30, 200] : t.kind === "rpe" ? [1, 10] : plan.sport === "swim" ? [50, 240] : [150, 720];
        if (t.low < min || t.high > max) v.push(`${name} must be between ${min} and ${max}.`);
      }
      if (t.kind === "power_pct_ftp" && plan.sport !== "bike" && plan.sport !== "brick") v.push(`${name}: power targets are for bike steps only.`);
      if (t.kind === "pace" && plan.sport === "bike") v.push(`${name}: use power or HR for bike steps, not pace.`);
    }
    if (s.minutes !== null && s.distance_m !== null) v.push(`Step ${i + 1} has both minutes and distance_m; use one.`);
    if (s.minutes === null && s.distance_m === null && plan.sport !== "rest") {
      v.push(`Step ${i + 1} ("${s.label}") has neither minutes nor distance_m.`);
    }
  }

  if (plan.sport === "rest" && plan.intensity !== "rest") v.push('A rest day must have intensity "rest".');
  if (plan.intensity === "rest" && plan.sport !== "rest" && plan.sport !== "mobility") {
    v.push('Intensity "rest" is only for sport "rest" or "mobility".');
  }

  if (checkin.pain && !["rest", "recovery"].includes(plan.intensity)) {
    v.push(`The athlete reported pain or illness ("${checkin.pain}"); intensity must be rest or recovery, not ${plan.intensity}.`);
  }

  if (plan.intensity === "hard") {
    const yesterday = addDays(ctx.date, -1);
    if (ctx.hardDates.includes(yesterday)) v.push("Yesterday was a hard day; no hard session on consecutive days.");
    const weekStart = addDays(ctx.date, -6);
    const hardInWindow = new Set(ctx.hardDates.filter((d) => d >= weekStart && d < ctx.date)).size;
    if (hardInWindow + 1 > ctx.maxHardPerWeek) {
      v.push(`There are already ${hardInWindow} hard days in the last 7 days; the limit is ${ctx.maxHardPerWeek}.`);
    }
  }

  const p = ctx.prefs;
  if (p) {
    if (plan.sport === "strength" && !p.strength) v.push("The athlete has strength sessions turned off.");
    const counted = (plan.sport === "brick" ? ["bike", "run"] : [plan.sport]).filter(
      (x): x is "swim" | "bike" | "run" => x === "swim" || x === "bike" || x === "run",
    );
    for (const sp of counted) {
      if (p.noSports.includes(sp)) v.push(`The athlete can't do ${sp} this week (change this week only).`);
      const max = p.maxSessions[sp];
      if (max !== null && p.sessionsLast6Days[sp] + 1 > max) {
        v.push(`That would be ${p.sessionsLast6Days[sp] + 1} ${sp} sessions in 7 days; the athlete's limit is ${max}.`);
      }
    }
    if (p.oneSidedBreathing && plan.sport === "swim") {
      const text = [plan.title, plan.why, plan.easier_option, ...plan.warnings, ...plan.steps.flatMap((s) => [s.label, s.target, s.notes ?? ""])].join(" ");
      if (/bilateral|both sides|every (3|three|5|five) strokes|alternate (breathing|sides)/i.test(text)) {
        v.push("The athlete keeps one-sided breathing: never ask for bilateral or alternate-side breathing, in any set.");
      }
    }
  }

  if (!plan.why.trim()) v.push('"why" is empty.');
  return v;
}

// Style rule from the coaching brief: no em dashes. Fixed in place rather than
// spending a retry on punctuation.
export function tidyText(plan: Plan): Plan {
  const fix = (s: string) => s.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, " to ");
  return {
    ...plan,
    title: fix(plan.title),
    why: fix(plan.why),
    easier_option: fix(plan.easier_option),
    warnings: plan.warnings.map(fix),
    steps: plan.steps.map((s) => ({
      ...s,
      label: fix(s.label),
      target: fix(s.target),
      notes: s.notes === null ? null : fix(s.notes),
    })),
  };
}
