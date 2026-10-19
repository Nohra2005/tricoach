import { describe, expect, it } from "vitest";
import type { StoredPlan } from "../shared/schemas";
import { parsedSummary, toWorkoutText, watchType, whyNotSendable } from "../netlify/functions/lib/workout-text";

type Step = StoredPlan["steps"][number];
const step = (s: Partial<Step>): Step => ({
  label: "Step",
  minutes: null,
  distance_m: null,
  target: "",
  target_spec: { kind: "none", low: null, high: null },
  reps: null,
  rest_seconds: null,
  notes: null,
  ...s,
});
const base = { title: "T", total_minutes: 45, intensity: "easy" as const, why: "", easier_option: "", warnings: [] };

describe("toWorkoutText", () => {
  it("writes a swim with distances, pace targets, repeats and rest", () => {
    const plan: StoredPlan = {
      ...base,
      sport: "swim",
      steps: [
        step({ label: "Warm-up", distance_m: 300 }),
        step({ label: "6 x 50 catch-up drill", distance_m: 50, reps: 6, rest_seconds: 20, target_spec: { kind: "rpe", low: 4, high: 4 } }),
        step({ label: "Main set", distance_m: 200, reps: 4, rest_seconds: 30, target_spec: { kind: "pace", low: 135, high: 140 } }),
        step({ label: "Cool-down", distance_m: 200 }),
      ],
    };
    expect(toWorkoutText(plan)).toBe(
      [
        "- Warm-up 300mtr",
        "",
        "6x",
        "- catch-up drill 50mtr",
        "- Rest 20s",
        "",
        "4x",
        "- Main set 200mtr 2:20-2:15/100m Pace",
        "- Rest 30s",
        "",
        "- Cool-down 200mtr",
      ].join("\n"),
    );
  });

  it("writes a bike with power and HR targets", () => {
    const plan: StoredPlan = {
      ...base,
      sport: "bike",
      steps: [
        step({ label: "Warm up Z2", minutes: 10, target_spec: { kind: "hr_zone", low: 1, high: 2 } }),
        step({ label: "Sweet spot", minutes: 8, reps: 3, rest_seconds: 120, target_spec: { kind: "power_pct_ftp", low: 88, high: 93 } }),
        step({ label: "Spin", minutes: 1.5, target_spec: { kind: "power_pct_ftp", low: 50, high: 50 } }),
      ],
    };
    expect(toWorkoutText(plan)).toBe(
      ["- Warm up 10m Z1-Z2 HR", "", "3x", "- Sweet spot 8m 88-93%", "- Rest 2m", "", "- Spin 1m30 50%"].join("\n"),
    );
  });

  it("writes run distances in km and strips keywords from labels", () => {
    const plan: StoredPlan = {
      ...base,
      sport: "run",
      steps: [step({ label: "Ramp to pace", distance_m: 5000, target_spec: { kind: "pace", low: 330, high: 340 } })],
    };
    expect(toWorkoutText(plan)).toBe("- to 5km 5:40-5:30/km Pace");
  });
});

describe("watchType and whyNotSendable", () => {
  const p = (sport: StoredPlan["sport"], steps: Step[] = [step({ minutes: 10 })]): StoredPlan => ({ ...base, sport, steps });
  it("maps sports and indoor riding", () => {
    expect(watchType(p("bike"), { locations: ["indoor_trainer"] })).toBe("VirtualRide");
    expect(watchType(p("bike"), { locations: ["indoor_trainer", "outdoor_bike"] })).toBe("Ride");
    expect(watchType(p("swim"), null)).toBe("Swim");
    expect(watchType(p("brick"), null)).toBeNull();
  });
  it("explains what cannot be sent", () => {
    expect(whyNotSendable(p("rest"))).toContain("Rest");
    expect(whyNotSendable(p("brick"))).toContain("Brick");
    expect(whyNotSendable(p("run", [step({ minutes: 10, target_spec: null })]))).toContain("Rewrite");
    expect(whyNotSendable(p("run"))).toBeNull();
  });
});

describe("parsedSummary", () => {
  it("counts parsed steps including repeat blocks", () => {
    const doc = { duration: 2700, steps: [{ duration: 600 }, { reps: 4, steps: [{ duration: 300 }, { duration: 60 }] }, { duration: 300 }] };
    expect(parsedSummary(doc)).toEqual({ steps: 4, minutes: 45 });
    expect(parsedSummary(null)).toEqual({ steps: null, minutes: null });
  });
});
