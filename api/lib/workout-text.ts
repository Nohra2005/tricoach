// Converts a plan into intervals.icu workout builder text, which intervals.icu turns into
// a structured workout and sends to Garmin Connect. Syntax (intervals.icu forum, "Workout
// builder" and "Workout Builder Syntax Quick Guide"):
//   - step lines start with "- "; text before the duration is the step label
//   - durations: 10m, 30s, 1m30 (m means minutes); distances: 400mtr, 2km
//   - power: 88-93% (of FTP); HR zone: Z2 HR, Z2-Z3 HR; pace: 5:40-5:30/km Pace
//   - repeats: a line "4x" with a blank line before and after the block
// Swim specifics (intervals.icu forum swim threads, and the intervals-icu-mcp changelog,
// which checked what the server actually parses):
//   - swim steps are sent WITHOUT targets: Garmin Connect does not accept a speed/pace
//     target on pool swim steps, and a swim workout with one shows "Unable to load
//     steps" there. The pace stays in the app (the step's human-readable target).
//   - pool length: intervals.icu uses 25 m unless told otherwise; an explicit
//     "pool length" line has been reported to break the Garmin Connect view, so none is sent
//   - only "intensity=rest" exports a real rest step to the device
//   - "intensity=warmup" / "intensity=cooldown" mark the step type
// If a description does not parse, intervals.icu stores it as plain text and Garmin
// shows a note instead of steps, so the sender reads back workout_doc and retries with
// the "simple" variant (no labels) before giving up.
import type { CheckIn, StoredPlan } from "../../shared/schemas";
import { fmtSecs, type HrZone } from "./thresholds";

// Heart rate steps: intervals.icu's "Z2 HR" would use the zones typed in its settings,
// so the athlete's measured zones are sent as % of the max HR intervals.icu holds
// ("74-82% HR"), which it turns into the same bpm on the watch. Without both, "Z2 HR".
export interface HrTargets {
  zones: HrZone[];
  intervalsMaxHr: number | null;
}

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
export type TextVariant = "full" | "simple";

function target(step: Step, sport: StoredPlan["sport"], hr?: HrTargets): string {
  const t = step.target_spec;
  if (!t || t.low === null || t.high === null) return "";
  if (sport === "swim") return ""; // see the note at the top: Garmin rejects swim targets
  const range = (a: number, b: number) => (Math.round(a) === Math.round(b) ? `${Math.round(a)}` : `${Math.round(a)}-${Math.round(b)}`);
  switch (t.kind) {
    case "power_pct_ftp":
      return `${range(t.low, t.high)}%`;
    case "hr_zone": {
      const lo = hr?.zones.find((z) => z.zone === Math.round(t.low!));
      const hi = hr?.zones.find((z) => z.zone === Math.round(t.high!));
      const max = hr?.intervalsMaxHr;
      if (lo && hi && max) {
        const a = Math.floor((lo.lo / max) * 100);
        const b = Math.ceil((hi.hi / max) * 100);
        return `${a}-${b}% HR`;
      }
      return t.low === t.high ? `Z${t.low} HR` : `Z${t.low}-Z${t.high} HR`;
    }
    case "pace": {
      // slower pace first, as in the intervals.icu examples ("7:15-7:00/km Pace")
      return t.low === t.high ? `${fmtSecs(t.low)}/km Pace` : `${fmtSecs(t.high)}-${fmtSecs(t.low)}/km Pace`;
    }
    default:
      return ""; // rpe and none: open step on the watch
  }
}

function stepType(label: string): string {
  if (/warm/i.test(label)) return "intensity=warmup";
  if (/cool|easy down|loosen/i.test(label)) return "intensity=cooldown";
  return "";
}

function line(step: Step, sport: StoredPlan["sport"], variant: TextVariant, hr?: HrTargets): string | null {
  const amount =
    step.distance_m !== null ? distance(step.distance_m, sport === "swim") : step.minutes !== null ? duration(step.minutes) : null;
  if (!amount) return null;
  const label = variant === "full" ? cleanLabel(step.label) : "";
  return ["-", label, amount, target(step, sport, hr), stepType(step.label)].filter(Boolean).join(" ");
}

const restLine = (seconds: number) => `- ${duration(seconds / 60)} intensity=rest`;

export function toWorkoutText(plan: StoredPlan, variant: TextVariant = "full", hr?: HrTargets): string {
  const out: string[] = [];
  for (const step of plan.steps) {
    const l = line(step, plan.sport, variant, hr);
    if (!l) continue;
    if (step.reps && step.reps > 1) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${step.reps}x`);
      out.push(l);
      if (step.rest_seconds && step.rest_seconds > 0) out.push(restLine(step.rest_seconds));
      out.push("");
    } else {
      out.push(l);
      // a single step followed by rest (rare) still gets a real rest step
      if (step.rest_seconds && step.rest_seconds > 0) out.push(restLine(step.rest_seconds));
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
