import { describe, expect, it } from "vitest";
import { migrateSettings } from "../api/lib/settings-migrate";
import { BLANK_SETTINGS, DEFAULT_SETTINGS } from "../api/lib/defaults";
import { checkPlan } from "../api/lib/rules";
import { Settings, type CheckIn, type Plan } from "../shared/schemas";

const legacy = {
  profile: {
    name: "Tatiana",
    history: "Has finished a half Ironman (70.3), an Olympic and a sprint triathlon.",
    swim: "Breathes to one side and wants to keep it: do NOT prescribe bilateral breathing drills.",
    bike: "Indoor on a Tacx Flux S smart trainer.",
    run: "Group run Thursdays.",
    life: "",
    other_notes: "Knee was sore last month.",
  },
  plan: {
    goal_race: "Ironman 70.3 Lisbon",
    goal_race_date: "2027-05-16",
    ftp_watts: 230,
    threshold_run_pace: "4:40/km",
    swim_css: "1:55",
    max_hard_per_week: 1,
    usual_swim_days: ["Monday", "Friday"],
    set_sessions: [{ weekday: "Thursday", time: "17:00", sport: "run", description: "Group run" }],
    focus: "",
  },
};

describe("migrateSettings", () => {
  it("turns the old free-text profile into structured preferences and drops typed thresholds", () => {
    const s = migrateSettings(legacy, BLANK_SETTINGS);
    expect(Settings.safeParse(s).success).toBe(true);
    expect(s.races).toEqual([{ priority: "A", name: "Ironman 70.3 Lisbon", date: "2027-05-16", distance: "other" }]);
    expect(s.finished.sort()).toEqual(["70.3", "olympic", "sprint"]);
    expect(s.one_sided_breathing).toBe(true);
    expect(s.equipment.smart_trainer).toBe(true);
    expect(s.schedule.Monday.usual).toBe("pool");
    expect(s.schedule.Friday.usual).toBe("pool");
    expect(s.max_hard_per_week).toBe(1);
    expect(s.coach_note).toBe("Knee was sore last month.");
    expect(JSON.stringify(s)).not.toMatch(/230|4:40|1:55/);
  });

  it("keeps version 2 settings as they are, and falls back on junk", () => {
    expect(migrateSettings(DEFAULT_SETTINGS, BLANK_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ nonsense: true }, BLANK_SETTINGS)).toEqual(BLANK_SETTINGS);
  });
});

describe("preference rules", () => {
  const checkin: CheckIn = { energy: 4, soreness: 2, minutes: 60, locations: ["pool", "run", "gym"], pain: null };
  const step = { label: "Main", minutes: 40, distance_m: null, target: "Z2", target_spec: { kind: "hr_zone" as const, low: 2, high: 2 }, reps: null, rest_seconds: null, notes: null };
  const plan = (p: Partial<Plan>): Plan => ({ sport: "run", title: "Run", total_minutes: 40, intensity: "easy", steps: [step], why: "x", easier_option: "y", warnings: [], ...p });
  const ctx = (prefs: Partial<NonNullable<Parameters<typeof checkPlan>[1]["prefs"]>> = {}) => ({
    date: "2026-10-20",
    checkin,
    hardDates: [],
    maxHardPerWeek: 2,
    prefs: { strength: false, maxSessions: { swim: 3, bike: null, run: 2 }, oneSidedBreathing: true, noSports: [], sessionsLast6Days: { swim: 1, bike: 0, run: 2 }, ...prefs },
  });

  it("enforces max sessions per sport over 7 days", () => {
    expect(checkPlan(plan({}), ctx()).join(" ")).toContain("3 run sessions in 7 days; the athlete's limit is 2");
    expect(checkPlan(plan({}), ctx({ sessionsLast6Days: { swim: 0, bike: 0, run: 1 } }))).toEqual([]);
  });

  it("respects strength off and this week's change", () => {
    expect(checkPlan(plan({ sport: "strength", steps: [{ ...step, target_spec: { kind: "none", low: null, high: null } }] }), ctx()).join(" ")).toContain("strength sessions turned off");
    expect(checkPlan(plan({}), ctx({ noSports: ["run"], sessionsLast6Days: { swim: 0, bike: 0, run: 0 } })).join(" ")).toContain("can't do run this week");
  });

  it("rejects bilateral breathing anywhere in a swim when one-sided breathing is set", () => {
    const swim = plan({ sport: "swim", steps: [{ ...step, label: "Main set", distance_m: 400, minutes: null, notes: "breathe every 3 strokes" }] });
    expect(checkPlan(swim, ctx()).join(" ")).toContain("one-sided breathing");
    expect(checkPlan(swim, ctx({ oneSidedBreathing: false }))).toEqual([]);
  });
});
