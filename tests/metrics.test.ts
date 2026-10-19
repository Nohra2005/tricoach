import { describe, expect, it } from "vitest";
import { WellnessSchema } from "../netlify/functions/lib/intervals";
import { computeMetrics, mean, sd } from "../netlify/functions/lib/metrics";
import type { ActivitySummary } from "../shared/schemas";
import { wellnessRows } from "./fixtures";

const TODAY = "2026-10-19";

describe("stats", () => {
  it("computes mean and sample SD", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(sd([2, 4, 6])).toBe(2);
    expect(sd([5])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe("computeMetrics", () => {
  it("flags today's HRV when more than 1 SD below the prior 28-day mean", () => {
    const rows = wellnessRows(TODAY, 42, (i) => ({
      hrv: i === 41 ? 30 : 50 + (i % 2 ? 5 : -5),
      restingHR: 50,
      sleepSecs: 8 * 3600,
      ctl: 60,
      atl: 70,
    })).map((r) => WellnessSchema.parse(r));
    const m = computeMetrics(TODAY, rows, [], 0);
    expect(m.today.hrv).toBe(30);
    expect(m.baselines.hrv.n28).toBe(28);
    expect(m.baselines.hrv.mean28).toBe(50);
    expect(m.today.tsb).toBe(-10);
    const f = m.flags.find((x) => x.metric === "hrv");
    expect(f?.direction).toBe("below");
    expect(f?.rule).toContain("28-day mean 50");
    // constant resting HR: today equals the mean, so no flag
    expect(m.flags.find((x) => x.metric === "resting_hr")).toBeUndefined();
  });

  it("shows no data and no flag when today's values are missing", () => {
    const rows = wellnessRows(TODAY, 42, (i) => (i === 41 ? {} : { hrv: 50 + (i % 3) })).map((r) =>
      WellnessSchema.parse(r),
    );
    const m = computeMetrics(TODAY, rows, [], 0);
    expect(m.today.hrv).toBeNull();
    expect(m.today.sleep_hours).toBeNull();
    expect(m.today.tsb).toBeNull();
    expect(m.flags).toHaveLength(0);
  });

  it("does not compute a range from fewer than 10 days", () => {
    const rows = wellnessRows(TODAY, 42, (i) => (i > 33 ? { hrv: i === 41 ? 10 : 50 + (i % 2) } : {})).map((r) =>
      WellnessSchema.parse(r),
    );
    const m = computeMetrics(TODAY, rows, [], 0);
    expect(m.baselines.hrv.n28).toBe(7);
    expect(m.flags).toHaveLength(0);
  });

  it("totals the last 7 days per sport", () => {
    const base: Omit<ActivitySummary, "id" | "date" | "start_local" | "minutes"> = {
      type: "Run",
      sport: "run",
      name: null,
      distance_km: 1,
      load: 10,
      intensity_pct: null,
      avg_hr: null,
      avg_watts: null,
      weighted_watts: null,
      pace_per_100m: null,
      pace_per_km: null,
      trainer: null,
      rpe: null,
      hard: false,
    };
    const acts: ActivitySummary[] = [
      { ...base, id: "a", date: "2026-10-19", start_local: "2026-10-19T07:00:00", minutes: 30 },
      { ...base, id: "b", date: "2026-10-13", start_local: "2026-10-13T07:00:00", minutes: 40 },
      { ...base, id: "c", date: "2026-10-12", start_local: "2026-10-12T07:00:00", minutes: 50 },
    ];
    const m = computeMetrics(TODAY, [], acts, 0);
    expect(m.last7.run).toEqual({ sessions: 2, minutes: 70, load: 20, distance_km: 2 });
    expect(m.activities14[0].id).toBe("a");
  });
});
