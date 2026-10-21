import { describe, expect, it } from "vitest";
import type { CheckIn, Plan } from "../shared/schemas";
import { checkPlan, tidyText } from "../api/lib/rules";
import { matchActivity } from "../api/lib/match";
import { ActivitySchema, summarise } from "../api/lib/intervals";
import { activityRaw, emptyDayForTest } from "./fixtures";

const checkin: CheckIn = {
  energy: 4,
  soreness: 2,
  motivation: 4,
  stress: 2,
  minutes: 60,
  locations: ["run", "indoor_trainer"],
  pain: null,
};
const plan: Plan = {
  sport: "run",
  title: "Easy run",
  total_minutes: 45,
  intensity: "easy",
  steps: [
    { label: "Warm-up", minutes: 10, distance_m: null, target: "RPE 3", target_spec: { kind: "rpe", low: 3, high: 3 }, reps: null, rest_seconds: null, notes: null },
    { label: "Steady", minutes: 30, distance_m: null, target: "Z2", target_spec: { kind: "hr_zone", low: 2, high: 2 }, reps: null, rest_seconds: null, notes: null },
    { label: "Cool-down", minutes: 5, distance_m: null, target: "RPE 2", target_spec: { kind: "rpe", low: 2, high: 2 }, reps: null, rest_seconds: null, notes: null },
  ],
  why: "HRV is 52 ms, inside the range.",
  easier_option: "30 minutes easy.",
  warnings: [],
};
const ctx = { date: "2026-10-19", checkin, hardDates: [] as string[], maxHardPerWeek: 2 };

describe("checkPlan", () => {
  it("accepts a valid plan", () => {
    expect(checkPlan(plan, ctx)).toEqual([]);
  });

  it("rejects a pool session when the pool is not available", () => {
    expect(checkPlan({ ...plan, sport: "swim" }, ctx).join(" ")).toContain("pool");
  });

  it("rejects going over the available time", () => {
    expect(checkPlan({ ...plan, total_minutes: 90 }, ctx).join(" ")).toContain("only 60 minutes");
  });

  it("rejects hard after a hard day and over the weekly cap", () => {
    const hard = { ...plan, intensity: "hard" as const };
    expect(checkPlan(hard, { ...ctx, hardDates: ["2026-10-18"] }).join(" ")).toContain("consecutive");
    expect(checkPlan(hard, { ...ctx, hardDates: ["2026-10-14", "2026-10-16"] }).join(" ")).toContain("limit is 2");
    expect(checkPlan(hard, { ...ctx, hardDates: ["2026-10-10", "2026-10-16"] })).toEqual([]);
  });

  it("forces rest or recovery when pain is reported", () => {
    const c = { ...checkin, pain: "knee hurts" };
    expect(checkPlan(plan, { ...ctx, checkin: c }).join(" ")).toContain("pain or illness");
    expect(checkPlan({ ...plan, intensity: "recovery" }, { ...ctx, checkin: c })).toEqual([]);
  });

  it("counts reps when summing step minutes", () => {
    const p = { ...plan, steps: [{ ...plan.steps[0], minutes: 10, reps: 6 }] };
    expect(checkPlan(p, ctx).join(" ")).toContain("add up to 60");
  });
});

describe("tidyText", () => {
  it("removes em dashes", () => {
    expect(tidyText({ ...plan, why: "Sleep was short — keep it easy." }).why).toBe("Sleep was short, keep it easy.");
  });
});

describe("matchActivity", () => {
  const swim = summarise(ActivitySchema.parse(activityRaw)); // 2026-10-18
  const run = summarise(ActivitySchema.parse({ ...activityRaw, id: "r1", type: "Run", moving_time: 1800 }));

  it("prefers an activity of the planned sport on the same date", () => {
    const day = { ...emptyDayForTest("2026-10-18"), plan: { ...plan, sport: "run" as const } };
    const m = matchActivity(day, [swim, run]);
    expect(m?.id).toBe("r1");
    expect(m?.match_rule).toContain("compatible");
  });

  it("falls back to a different sport and says so", () => {
    const day = { ...emptyDayForTest("2026-10-18"), plan: { ...plan, sport: "bike" as const } };
    expect(matchActivity(day, [swim, run])?.match_rule).toContain("different sport");
  });

  it("returns null when nothing was recorded that day", () => {
    expect(matchActivity({ ...emptyDayForTest("2026-10-19"), plan }, [swim])).toBeNull();
  });
});
