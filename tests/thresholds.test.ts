import { describe, expect, it } from "vitest";
import { AthleteSchema, WellnessSchema } from "../netlify/functions/lib/intervals";
import { buildThresholds, parsePace, typicalValues } from "../netlify/functions/lib/thresholds";
import { latestValue } from "../netlify/functions/lib/metrics";
import type { ActivitySummary, Settings } from "../shared/schemas";
import { DEFAULT_SETTINGS } from "../netlify/functions/lib/defaults";

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

const plan: Settings["plan"] = { ...DEFAULT_SETTINGS.plan };

describe("buildThresholds", () => {
  it("reads FTP, zones and threshold paces from intervals.icu", () => {
    const t = buildThresholds(athlete, plan);
    expect(t.bike.threshold).toBe("FTP 200 W");
    expect(t.bike.threshold_source).toBe("intervals.icu");
    expect(t.bike.work_zones[1]).toBe("Z2 Endurance: 55 to 75% FTP (110 to 150 W)");
    expect(t.bike.work_zones[6]).toBe("Z7 Neuromuscular: above 150% FTP (300 W)");
    expect(t.bike.hr_zones[0]).toBe("Z1 Recovery: up to 138 bpm");
    expect(t.bike.hr_zones[1]).toBe("Z2 Aerobic: 139 to 151 bpm");
    expect(t.run.threshold).toBe("4:45/km");
    expect(t.run.work_zones[0]).toBe("Z1: slower than 6:08/km");
    expect(t.swim.threshold).toBe("2:05/100m");
    expect(t.swim.work_zones[3]).toBe("Z4: faster than 2:05/100m");
    expect(t.notes).toEqual([]);
  });

  it("with no estimates, prefers values typed in TriCoach Settings over intervals.icu", () => {
    const t = buildThresholds(athlete, { ...plan, ftp_watts: 210, threshold_run_pace: "5:00/km", swim_css: "2:10" });
    expect(t.bike.threshold).toBe("FTP 210 W");
    expect(t.bike.threshold_source).toBe("settings");
    expect(t.bike.work_zones[1]).toContain("(116 to 158 W)");
    expect(t.run.threshold).toBe("5:00/km");
    expect(t.swim.threshold).toBe("2:10/100m");
  });

  it("ignores an implausible threshold pace instead of guessing units", () => {
    const odd = AthleteSchema.parse({ id: "i1", sportSettings: [{ types: ["Run"], threshold_pace: 285 }] });
    const t = buildThresholds(odd, plan);
    expect(t.run.threshold).toBeNull();
    expect(t.notes[0]).toContain("Ignored");
  });

  it("works with no intervals.icu data at all", () => {
    const t = buildThresholds(null, plan);
    expect(t.bike.threshold).toBeNull();
    expect(t.run.hr_zones).toEqual([]);
    expect(t.notes[0]).toContain("Could not read sport settings");
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
