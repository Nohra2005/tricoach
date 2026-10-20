// Thresholds estimated from the athlete's own sessions. These take priority over any value
// typed in by hand (TriCoach Settings or intervals.icu settings), which are only used when
// there is no estimate yet. Pure functions; the data comes from intervals.icu:
//   FTP:  intervals.icu eFTP, on each wellness record (sportInfo[].eftp, type Ride)
//   run:  critical speed from the run pace curve (paceModels, type "CS"), else best 5 km + 5%
//   swim: CSS = 200 / (best 400 m time - best 200 m time), else the curve's critical speed
import { z } from "zod";
import type { Wellness } from "./intervals";

export const ESTIMATE_DAYS = 84; // pace curves cover the last 12 weeks

export interface Estimate {
  value: number; // watts for FTP; seconds per km (run) or per 100 m (swim)
  basis: string; // shown to the athlete and the model
}
export interface Estimates {
  ftp: Estimate | null;
  run: Estimate | null;
  swim: Estimate | null;
}

const fmt = (secs: number) => {
  const t = Math.round(secs);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

// ---------- FTP ----------

const SportInfo = z.array(z.looseObject({ type: z.string().nullish(), eftp: z.number().nullish() })).catch([]);

export function eftpFromWellness(rows: Wellness[], date: string): Estimate | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const w = rows[i];
    if (w.id > date) continue;
    const info = SportInfo.parse((w as Record<string, unknown>).sportInfo ?? []);
    const ride = info.find((s) => (s.type === "Ride" || s.type === "VirtualRide") && s.eftp && s.eftp > 40 && s.eftp < 600);
    if (ride?.eftp) return { value: Math.round(ride.eftp), basis: `intervals.icu eFTP from your rides with power (${w.id})` };
  }
  return null;
}

// ---------- pace curves ----------

export const PaceCurveSet = z.looseObject({
  list: z
    .array(
      z.looseObject({
        distance: z.array(z.number()).catch([]),
        values: z.array(z.number().nullable()).catch([]),
        paceModels: z
          .array(z.looseObject({ type: z.string().nullish(), criticalSpeed: z.number().nullish(), r2: z.number().nullish() }))
          .nullish(),
        days: z.number().nullish(),
      }),
    )
    .catch([]),
});
export type PaceCurveSet = z.infer<typeof PaceCurveSet>;

// Best time in seconds for a distance (exact point, else the nearest within 10%).
// values are times in seconds; if they look like speeds (m/s) they are converted.
export function bestTime(curve: PaceCurveSet["list"][number], metres: number): number | null {
  let best: { d: number; t: number } | null = null;
  curve.distance.forEach((d, i) => {
    let t = curve.values[i];
    if (t === null || t === undefined || t <= 0) return;
    if (t < 15 && d >= 100) t = d / t; // a speed, not a time
    if (Math.abs(d - metres) <= metres * 0.1 && (!best || Math.abs(d - metres) < Math.abs(best.d - metres))) best = { d, t };
  });
  if (!best) return null;
  const b = best as { d: number; t: number };
  return (b.t * metres) / b.d; // scale to the exact distance
}

function criticalSpeed(curve: PaceCurveSet["list"][number], lo: number, hi: number) {
  const m = curve.paceModels?.find((p) => p.type === "CS" && p.criticalSpeed);
  if (!m?.criticalSpeed || m.criticalSpeed < lo || m.criticalSpeed > hi) return null;
  if (m.r2 !== null && m.r2 !== undefined && m.r2 < 0.9) return null; // poor model fit
  return { cs: m.criticalSpeed, r2: m.r2 ?? null };
}

export function runThreshold(set: PaceCurveSet | null, days = ESTIMATE_DAYS): Estimate | null {
  const curve = set?.list[0];
  if (!curve) return null;
  const cs = criticalSpeed(curve, 1.5, 7);
  if (cs) {
    return {
      value: 1000 / cs.cs,
      basis: `critical speed from your best runs in the last ${days} days${cs.r2 ? ` (model fit ${cs.r2.toFixed(2)})` : ""}`,
    };
  }
  const t5 = bestTime(curve, 5000);
  if (t5) {
    const pace = t5 / 5;
    return { value: pace * 1.05, basis: `your best 5 km in the last ${days} days (${fmt(pace)}/km) plus 5%` };
  }
  return null;
}

export function swimCss(set: PaceCurveSet | null, days = ESTIMATE_DAYS): Estimate | null {
  const curve = set?.list[0];
  if (!curve) return null;
  const t200 = bestTime(curve, 200);
  const t400 = bestTime(curve, 400);
  if (t200 && t400 && t400 > t200 * 1.8) {
    const per100 = (100 * (t400 - t200)) / 200;
    if (per100 >= 50 && per100 <= 240) {
      return {
        value: per100,
        basis: `CSS from your best 200 m (${fmt(t200)}) and 400 m (${fmt(t400)}) in the last ${days} days`,
      };
    }
  }
  const cs = criticalSpeed(curve, 0.4, 2.5);
  if (cs) return { value: 100 / cs.cs, basis: `critical speed from your best swims in the last ${days} days` };
  return null;
}
