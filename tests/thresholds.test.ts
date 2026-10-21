import { describe, expect, it } from "vitest";
import { AthleteSchema, WellnessSchema } from "../netlify/functions/lib/intervals";
import { buildThresholds, measuredMaxHr, parsePace, typicalValues } from "../netlify/functions/lib/thresholds";
import { latestValue } from "../netlify/functions/lib/metrics";
import type { ActivitySummary } from "../shared/schemas";

const athlete = AthleteSchema.parse({
  id: "i1",
  name: "Test",
  sportSettings: [
    {
      types: ["Ride", "VirtualRide"],
      ftp: 200,
      indoor_ftp: 190,
      lthr: 165,
      max_hr: 185,
      hr_zones: [138, 151, 158, 165, 171, 176, 185],
      hr_zone_names: ["Recovery", "Aerobic", "Tempo", "SubThreshold", "SuperThreshold", "Aerobic Capacity", "Anaerobic"],
      power_zones: [55, 75, 90, 105, 120, 150, 999],
      power_zone_names: ["Active Recovery", "Endurance", "Tempo", "Threshold", "VO2 Max", "Anaerobic", "Neuromuscular"],
    },
    // 3.508 m/s = 4:45/km
    { types: ["Run", "TrailRun"], lthr: 170, max_hr: 190, threshold_pace: 3.508, pace_units: "MINS_KM", pace_zones: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999] },
    // 0.8 m/s = 2:05/100m
    { types: ["Swim"], threshold_pace: 0.8, pace_units: "SECS_100M", pace_zones: [80, 90, 100, 999] },
  ],
});

const est = {
  ftp: { value: 205, basis: "eFTP" },
  run: { value: 290, basis: "critical speed" },
  swim: { value: 120, basis: "CSS" },
};

describe("buildThresholds (data only)", () => {
  it("uses only estimates from sessions, with zones built on them", () => {
    const t = buildThresholds(athlete, est, { value: 196, basis: "max HR" });
    expect(t.bike).toMatchObject({ threshold: "FTP 205 W", threshold_source: "estimate", threshold_basis: "eFTP", missing: null });
    expect(t.bike.work_zones[1]).toBe("Z2 Endurance: 55 to 75% FTP (113 to 154 W)");
    expect(t.run.threshold).toBe("4:50/km");
    expect(t.run.work_zones[0]).toBe("Z1: slower than 6:14/km");
    expect(t.swim.threshold).toBe("2:00/100m");
  });

  it("never falls back to values typed in intervals.icu, and says they were not used", () => {
    const t = buildThresholds(athlete, { ftp: null, run: null, swim: null }, null);
    expect(t.bike.threshold).toBeNull();
    expect(t.bike.missing).toContain("ride with power");
    expect(t.bike.ignored).toBe("Not used: 200 W typed in intervals.icu settings (not measured).");
    expect(t.run.ignored).toContain("4:45/km");
    expect(t.swim.ignored).toContain("2:05/100m");
    expect(t.bike.work_zones).toEqual([]);
  });

  it("says nothing about a typed value that matches the measured one", () => {
    const t = buildThresholds(athlete, { ftp: { value: 200, basis: "eFTP" }, run: null, swim: null }, null);
    expect(t.bike.threshold).toBe("FTP 200 W");
    expect(t.bike.ignored).toBeNull();
  });

  it("builds heart rate zones from the measured max HR, not intervals.icu settings", () => {
    const t = buildThresholds(athlete, est, { value: 200, basis: "max HR" });
    expect(t.heart?.zones[0]).toBe("Z1 Warm-up: 100 to 120 bpm");
    expect(t.heart?.zones[4]).toBe("Z5 Maximum: 180 to 200 bpm");
    expect(t.run.hr_zones).toEqual(t.heart?.zones);
    expect(t.bike.lthr).toBeNull(); // the typed LTHR is not used
  });

  it("uses heart rate reserve when the resting HR is known", () => {
    const t = buildThresholds(athlete, est, { value: 190, basis: "max HR" }, { value: 53, basis: "28-day average" });
    // Z2 = 53 + 60..70% of (190 - 53)
    expect(t.heart?.zones[1]).toBe("Z2 Easy: 135 to 149 bpm");
    expect(t.heart?.zones[4]).toBe("Z5 Maximum: 176 to 190 bpm");
    expect(t.heart?.basis).toContain("heart rate reserve");
  });

  it("works with no intervals.icu data at all", () => {
    const t = buildThresholds(null, null, null);
    expect(t.bike.threshold).toBeNull();
    expect(t.bike.ignored).toBeNull();
    expect(t.run.hr_zones).toEqual([]);
    expect(t.notes[0]).toContain("heart rate");
  });
});

describe("measuredMaxHr", () => {
  it("ignores a single spike and impossible values", () => {
    expect(measuredMaxHr([180, 186, 188, 231, 214])).toBe(188); // 214 is a lone spike
    expect(measuredMaxHr([170, 172])).toBe(172);
    expect(measuredMaxHr([175])).toBe(175);
    expect(measuredMaxHr([null, 90])).toBeNull();
  });
});

describe("parsePace", () => {
  it("parses m:ss with or without a unit", () => {
    expect(parsePace("5:10/km")).toBe(310);
    expect(parsePace("2:05")).toBe(125);
    expect(parsePace("fast")).toBeNull();
  });
});

describe("typicalValues", () => {
  const act = (date: string, sport: ActivitySummary["sport"], minutes: number, km: number, extra: Partial<ActivitySummary> = {}): ActivitySummary => ({
    id: date + sport,
    date,
    start_local: `${date}T07:00:00`,
    type: sport,
    sport,
    name: null,
    minutes,
    distance_km: km,
    load: 40,
    intensity_pct: null,
    avg_hr: 140,
    avg_watts: null,
    weighted_watts: null,
    pace_per_100m: null,
    pace_per_km: null,
    trainer: null,
    rpe: null,
    hard: false,
    ...extra,
  });

  it("computes median pace and the middle half over the window", () => {
    const acts = [
      act("2026-10-18", "run", 50, 10), // 5:00/km
      act("2026-10-15", "run", 55, 10), // 5:30/km
      act("2026-10-12", "run", 60, 10), // 6:00/km
      act("2026-10-09", "run", 65, 10), // 6:30/km
      act("2026-08-01", "run", 30, 10), // outside 42 days
      act("2026-10-17", "swim", 40, 2), // 2:00/100m
      act("2026-10-16", "bike", 60, 30, { avg_watts: 150 }),
    ];
    const t = typicalValues(acts, "2026-10-19");
    expect(t.run.sessions).toBe(4);
    expect(t.run.median_pace).toBe("5:45/km");
    expect(t.run.middle_half).toBe("5:23 to 6:08/km");
    expect(t.swim.median_pace).toBe("2:00/100m");
    expect(t.bike.median_avg_watts).toBe(150);
    expect(t.bike.median_pace).toBeNull();
  });
});

describe("latestValue", () => {
  it("returns the most recent non-null value on or before the date", () => {
    const rows = [
      { id: "2026-10-16", hrv: 50 },
      { id: "2026-10-17", hrv: 48 },
      { id: "2026-10-18" },
      { id: "2026-10-19" },
    ].map((r) => WellnessSchema.parse(r));
    expect(latestValue(rows, (w) => w.hrv, "2026-10-19")).toEqual({ value: 48, date: "2026-10-17" });
    expect(latestValue(rows, (w) => w.restingHR, "2026-10-19")).toBeNull();
  });
});
