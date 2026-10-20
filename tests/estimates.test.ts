import { describe, expect, it } from "vitest";
import { PaceCurveSet, bestTime, eftpFromWellness, runThreshold, swimCss } from "../netlify/functions/lib/estimates";
import { AthleteSchema, WellnessSchema } from "../netlify/functions/lib/intervals";
import { buildThresholds } from "../netlify/functions/lib/thresholds";
import { DEFAULT_SETTINGS } from "../netlify/functions/lib/defaults";

const curve = (distance: number[], values: number[], paceModels: unknown[] = []) =>
  PaceCurveSet.parse({ list: [{ distance, values, paceModels }] });

describe("eFTP", () => {
  it("takes the latest Ride eFTP on or before the date", () => {
    const rows = [
      { id: "2026-10-18", sportInfo: [{ type: "Ride", eftp: 198 }] },
      { id: "2026-10-19", sportInfo: [{ type: "Run", eftp: null }] },
      { id: "2026-10-20", sportInfo: [{ type: "Ride", eftp: 230 }] },
    ].map((r) => WellnessSchema.parse(r));
    expect(eftpFromWellness(rows, "2026-10-19")?.value).toBe(198);
    expect(eftpFromWellness([WellnessSchema.parse({ id: "2026-10-19" })], "2026-10-19")).toBeNull();
  });
});

describe("run threshold", () => {
  it("uses critical speed when the model fits well", () => {
    const e = runThreshold(curve([5000], [1375], [{ type: "CS", criticalSpeed: 3.448, r2: 0.97 }]));
    expect(Math.round(e!.value)).toBe(290); // 4:50/km
    expect(e!.basis).toContain("critical speed");
  });

  it("falls back to best 5 km plus 5% when there is no usable model", () => {
    // 5 km in 22:55 = 4:35/km; +5% = 4:49/km
    const e = runThreshold(curve([3000, 5000], [780, 1375], [{ type: "CS", criticalSpeed: 3.4, r2: 0.5 }]));
    expect(Math.round(e!.value)).toBe(289);
    expect(e!.basis).toContain("best 5 km");
  });

  it("returns null with no runs", () => {
    expect(runThreshold(curve([], []))).toBeNull();
    expect(runThreshold(null)).toBeNull();
  });
});

describe("swim CSS", () => {
  it("computes CSS from best 200 m and 400 m", () => {
    // 200 m 3:32, 400 m 7:32 -> (452 - 212) / 2 = 120 s per 100 m = 2:00/100m
    const e = swimCss(curve([100, 200, 400], [98, 212, 452]));
    expect(e!.value).toBe(120);
    expect(e!.basis).toContain("200 m (3:32) and 400 m (7:32)");
  });

  it("scales the nearest distance within 10%", () => {
    expect(bestTime(curve([375, 425], [400, 460]).list[0], 400)).toBeCloseTo((400 * 400) / 375, 5);
  });

  it("ignores impossible values", () => {
    expect(swimCss(curve([200, 400], [212, 300]))).toBeNull(); // 400 m barely slower than 200 m
  });
});

describe("priority", () => {
  const athlete = AthleteSchema.parse({ id: "i1", sportSettings: [{ types: ["Ride"], ftp: 200 }, { types: ["Swim"], threshold_pace: 0.8333 }] });

  it("prefers estimates over intervals.icu and TriCoach settings, and says so", () => {
    const t = buildThresholds(athlete, { ...DEFAULT_SETTINGS.plan, ftp_watts: 180, threshold_run_pace: "5:20/km" }, {
      ftp: { value: 215, basis: "eFTP" },
      run: { value: 290, basis: "critical speed" },
      swim: { value: 118, basis: "CSS" },
    });
    expect(t.bike).toMatchObject({ threshold: "FTP 215 W", threshold_source: "estimate", threshold_basis: "eFTP" });
    expect(t.run).toMatchObject({ threshold: "4:50/km", threshold_source: "estimate" });
    expect(t.swim).toMatchObject({ threshold: "1:58/100m", threshold_source: "estimate" });
    expect(t.notes.join(" ")).toContain("instead of the 180 W typed in TriCoach");
  });

  it("falls back to typed values only where there is no estimate", () => {
    const t = buildThresholds(athlete, { ...DEFAULT_SETTINGS.plan, ftp_watts: null }, { ftp: null, run: null, swim: null });
    expect(t.bike).toMatchObject({ threshold: "FTP 200 W", threshold_source: "intervals.icu" });
    expect(t.swim).toMatchObject({ threshold: "2:00/100m", threshold_source: "intervals.icu" });
    expect(t.run.threshold).toBeNull();
  });
});
