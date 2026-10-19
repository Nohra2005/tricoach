// Converts a plan into intervals.icu workout builder text, which intervals.icu turns into
// a structured workout and sends to Garmin Connect. Syntax (intervals.icu forum, "Workout
// builder" and "Workout Builder Syntax Quick Guide"):
//   - step lines start with "- "; text before the duration is the step label
//   - durations: 10m, 30s, 1m30 (m means minutes); distances: 400mtr, 2km
//   - power: 88-93% (of FTP); HR zone: Z2 HR, Z2-Z3 HR; pace: 5:40-5:30/km Pace
//   - repeats: a line "4x" with a blank line before and after the block
import type { CheckIn, StoredPlan } from "../../../shared/schemas";
import { fmtSecs } from "./thresholds";

export type WatchSport = "Swim" | "Ride" | "VirtualRide" | "Run";

export function watchType(plan: StoredPlan, checkin: Pick<CheckIn, "locations"> | null): WatchSport | null {
  if (plan.sport === "swim") return "Swim";
  if (plan.sport === "run") return "Run";
  if (plan.sport === "bike") {
    const indoor = checkin?.locations.includes("indoor_trainer") && !checkin.locations.includes("outdoor_bike");
    return indoor ? "VirtualRide" : "Ride";
  }
  return null; // brick, strength, mobility, rest: not sent as a structured workout
}

export function whyNotSendable(plan: StoredPlan): string | null {
  if (plan.sport === "rest") return "Rest days are not sent to the watch.";
  if (plan.sport === "brick") return "Brick sessions can't be sent as one watch workout yet. Do the bike, then the run.";
  if (plan.sport === "strength" || plan.sport === "mobility") return "Only swim, bike and run sessions can be sent to the watch.";
  if (plan.steps.length === 0) return "This session has no steps to send.";
  if (plan.steps.some((s) => s.target_spec === null)) return "This plan was written before watch support. Rewrite it to send it.";
  return null;
}

// Labels must not contain numbers, units or syntax keywords, or intervals.icu reads them
// as part of the step (a duration, a ramp, a target).
function cleanLabel(s: string): string {
  return s
    .replace(/[0-9]+/g, " ")
    .replace(/\b(x|m|s|h|km|mtr|meters?|min|sec|w|bpm|rpm|ramp|pace|hr|lthr|ftp|freeride|press|lap|z)\b/gi, " ")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function duration(minutes: number): string {
  const secs = Math.max(1, Math.round(minutes * 60));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m${String(s).padStart(2, "0")}` : `${m}m`;
}

function distance(metres: number, swim: boolean): string {
  const m = Math.round(metres);
  if (!swim && m >= 1000 && m % 100 === 0) return `${m / 1000}km`;
  return `${m}mtr`;
}

type Step = StoredPlan["steps"][number];

function target(step: Step, sport: StoredPlan["sport"]): string {
  const t = step.target_spec;
  if (!t || t.low === null || t.high === null) return "";
  const range = (a: number, b: number) => (Math.round(a) === Math.round(b) ? `${Math.round(a)}` : `${Math.round(a)}-${Math.round(b)}`);
  switch (t.kind) {
    case "power_pct_ftp":
      return `${range(t.low, t.high)}%`;
    case "hr_zone":
      return t.low === t.high ? `Z${t.low} HR` : `Z${t.low}-Z${t.high} HR`;
    case "pace": {
      const unit = sport === "swim" ? "/100m" : "/km";
      // slower pace first, as in the intervals.icu examples ("7:15-7:00/km Pace")
      return t.low === t.high ? `${fmtSecs(t.low)}${unit} Pace` : `${fmtSecs(t.high)}-${fmtSecs(t.low)}${unit} Pace`;
    }
    default:
      return ""; // rpe and none: open step on the watch
  }
}

function line(step: Step, sport: StoredPlan["sport"]): string | null {
  const amount =
    step.distance_m !== null ? distance(step.distance_m, sport === "swim") : step.minutes !== null ? duration(step.minutes) : null;
  if (!amount) return null;
  return ["-", cleanLabel(step.label), amount, target(step, sport)].filter(Boolean).join(" ");
}

export function toWorkoutText(plan: StoredPlan): string {
  const out: string[] = [];
  for (const step of plan.steps) {
    const l = line(step, plan.sport);
    if (!l) continue;
    if (step.reps && step.reps > 1) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${step.reps}x`);
      out.push(l);
      if (step.rest_seconds && step.rest_seconds > 0) out.push(`- Rest ${duration(step.rest_seconds / 60)}`);
      out.push("");
    } else {
      out.push(l);
    }
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// Counts the steps intervals.icu parsed (repeat blocks count their inner steps once).
export function parsedSummary(workoutDoc: unknown): { steps: number | null; minutes: number | null } {
  if (!workoutDoc || typeof workoutDoc !== "object") return { steps: null, minutes: null };
  const doc = workoutDoc as { steps?: unknown[]; duration?: number };
  const count = (steps: unknown[] | undefined): number =>
    (steps ?? []).reduce<number>((n, s) => {
      const inner = (s as { steps?: unknown[] }).steps;
      return n + (Array.isArray(inner) ? count(inner) : 1);
    }, 0);
  return {
    steps: Array.isArray(doc.steps) ? count(doc.steps) : null,
    minutes: typeof doc.duration === "number" ? Math.round(doc.duration / 60) : null,
  };
}
