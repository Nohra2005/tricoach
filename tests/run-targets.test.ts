import { describe, expect, it } from "vitest";
import type { ActivitySummary, CheckIn, Plan, StoredPlan } from "../shared/schemas";
import { heartZoneBounds, parseHeartZones, heartZones, runPaceAtHr } from "../netlify/functions/lib/thresholds";
import { checkPlan } from "../netlify/functions/lib/rules";
import { toWorkoutText } from "../netlify/functions/lib/workout-text";
import { Settings } from "../shared/schemas";
import { BLANK_SETTINGS } from "../netlify/functions/lib/defaults";

const run = (avg_hr: number, pace: string, minutes = 45): ActivitySummary => ({
  id: `r${avg_hr}${pace}`,
  date: "2026-10-10",
  start_local: "2026-10-10T07:00:00",
  type: "Run",
  sport: "run",
  name: null,
  minutes,
  distance_km: 8,
  load: 50,
  intensity_pct: 70,
  avg_hr,
  avg_watts: null,
  weighted_watts: null,
  pace_per_100m: null,
  pace_per_km: pace,
  trainer: false,
  rpe: null,
  hard: false,
});

describe("runPaceAtHr", () => {
  const zones = heartZoneBounds(203, 53); // Z2 143-158, Z3 158-173
  it("finds the athlete's own pace at each heart rate zone", () => {
    // About 6:30/km at 140 bpm, 5:30/km at 170 bpm: 2 s/km faster per bpm.
    const runs = [run(140, "6:30/km"), run(145, "6:20/km"), run(150, "6:10/km"), run(160, "5:50/km"), run(170, "5:30/km"), run(155, "6:00/km", 10)];
    const r = runPaceAtHr(runs, zones, 42)!;
    expect(r.runs).toBe(5); // the 10 minute run is left out
    const z2 = r.zones.find((z) => z.zone === 2)!;
    expect([z2.hr_low, z2.hr_high]).toEqual([143, 158]);
    expect(z2.pace_slow).toBe(384); // 6:24 at 143 bpm
    expect(z2.pace_fast).toBe(354); // 5:54 at 158 bpm
    // Z5 (188-203 bpm) is beyond any run recorded, so no pace is invented.
    const z5 = r.zones.find((z) => z.zone === 5)!;
    expect(z5.pace_slow).toBeNull();
    expect(z5.text).toContain("no runs at this heart rate yet");
  });
  it("needs at least 5 runs and some spread in heart rate", () => {
    expect(runPaceAtHr([run(150, "6:00/km"), run(151, "5:58/km")], zones, 42)).toBeNull();
    expect(runPaceAtHr([150, 151, 152, 150, 151].map((h) => run(h, "6:00/km")), zones, 42)).toBeNull();
  });
});

describe("run target preference", () => {
  const checkin: CheckIn = { energy: 4, soreness: 2, minutes: 60, locations: ["run"], pain: null };
  const step = (kind: "hr_zone" | "pace" | "rpe") => ({
    label: "Main",
    minutes: 40,
    distance_m: null,
    target: "x",
    target_spec: kind === "pace" ? { kind, low: 350, high: 380 } : { kind, low: 2, high: 2 },
    reps: null,
    rest_seconds: null,
    notes: null,
  });
  const plan = (kind: "hr_zone" | "pace" | "rpe"): Plan => ({ sport: "run", title: "Run", total_minutes: 40, intensity: "easy", steps: [step(kind)], why: "x", easier_option: "y", warnings: [] });
  const ctx = (runTargets: "hr" | "pace") => ({
    date: "2026-10-21",
    checkin,
    hardDates: [],
    maxHardPerWeek: 2,
    prefs: { strength: false, maxSessions: { swim: null, bike: null, run: null }, oneSidedBreathing: false, noSports: [], sessionsLast6Days: { swim: 0, bike: 0, run: 0 }, runTargets },
  });
  it("rejects pace steps when the athlete chose heart rate, and the reverse", () => {
    expect(checkPlan(plan("pace"), ctx("hr")).join(" ")).toContain("heart rate targets");
    expect(checkPlan(plan("hr_zone"), ctx("hr"))).toEqual([]);
    expect(checkPlan(plan("hr_zone"), ctx("pace")).join(" ")).toContain("pace targets");
    expect(checkPlan(plan("rpe"), ctx("pace"))).toEqual([]);
  });
  it("defaults to heart rate for settings saved before the option existed", () => {
    const { run_targets: _, ...old } = BLANK_SETTINGS;
    expect(Settings.parse(old).run_targets).toBe("hr");
  });
});

describe("heart rate steps on the watch", () => {
  const plan: StoredPlan = {
    sport: "run",
    title: "Easy",
    total_minutes: 40,
    intensity: "easy",
    why: "",
    easier_option: "",
    warnings: [],
    steps: [{ label: "Easy run", minutes: 40, distance_m: null, target: "Z2", target_spec: { kind: "hr_zone", low: 2, high: 2 }, reps: null, rest_seconds: null, notes: null }],
  };
  it("sends the measured zone as % of the max HR intervals.icu holds", () => {
    const zones = parseHeartZones(heartZones(203, 53)); // Z2 143-158 bpm
    // intervals.icu max HR 200: 143/200 = 71.5% -> 71, 158/200 = 79% -> 79
    expect(toWorkoutText(plan, "full", { zones, intervalsMaxHr: 200 })).toBe("- Easy run 40m 71-79% HR");
  });
  it("falls back to the zone number without a max HR in intervals.icu", () => {
    expect(toWorkoutText(plan, "full", { zones: [], intervalsMaxHr: null })).toBe("- Easy run 40m Z2 HR");
  });
});
