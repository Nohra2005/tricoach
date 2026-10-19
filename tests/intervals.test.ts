import { describe, expect, it } from "vitest";
import { ActivitySchema, WellnessSchema, sportOf, summarise } from "../netlify/functions/lib/intervals";
import { activityRaw } from "./fixtures";

describe("intervals parsing", () => {
  it("turns missing and null wellness fields into null, never 0", () => {
    const w = WellnessSchema.parse({ id: "2026-10-19", hrv: null, ctl: 50.2 });
    expect(w.hrv).toBeNull();
    expect(w.sleepSecs).toBeNull();
    expect(w.restingHR).toBeNull();
    expect(w.ctl).toBe(50.2);
  });

  it("keeps unknown fields without failing", () => {
    const w = WellnessSchema.parse({ id: "2026-10-19", someNewField: 3 });
    expect(w.id).toBe("2026-10-19");
  });

  it("summarises a swim with pace per 100 m", () => {
    const s = summarise(ActivitySchema.parse(activityRaw));
    expect(s.sport).toBe("swim");
    expect(s.minutes).toBe(45);
    expect(s.distance_km).toBe(2);
    expect(s.pace_per_100m).toBe("2:15");
    expect(s.avg_watts).toBeNull();
    expect(s.hard).toBe(false);
  });

  it("marks hard sessions by intensity or RPE", () => {
    expect(summarise(ActivitySchema.parse({ ...activityRaw, icu_intensity: 88 })).hard).toBe(true);
    expect(summarise(ActivitySchema.parse({ ...activityRaw, icu_rpe: 8 })).hard).toBe(true);
  });

  it("maps sport types", () => {
    expect(sportOf("VirtualRide")).toBe("bike");
    expect(sportOf("TrailRun")).toBe("run");
    expect(sportOf("WeightTraining")).toBe("other");
    expect(sportOf(null)).toBe("other");
  });
});
