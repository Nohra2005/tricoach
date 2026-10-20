// Charts for the Analytics design: workout profile, fitness trend, week load.
import type { ActivitySummary, Metrics, StoredPlan } from "../../shared/schemas";
import { parseSecs } from "./paces";

type Step = StoredPlan["steps"][number];
const ZONE_COLORS = ["var(--z1)", "var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)", "var(--z6)"];

// Zone 1..6 for a step, from its machine-readable target.
function zoneOf(step: Step, sport: string, thresholdSecs: number | null): number {
  const t = step.target_spec;
  if (!t || t.low === null || t.high === null) return 1;
  const mid = (t.low + t.high) / 2;
  const band = (x: number, cuts: number[]) => cuts.filter((c) => x > c).length + 1;
  switch (t.kind) {
    case "power_pct_ftp":
      return Math.min(6, band(mid, [55, 75, 90, 105, 120]));
    case "hr_zone":
      return Math.max(1, Math.min(6, Math.round(mid)));
    case "pace":
      return thresholdSecs ? Math.min(6, band((thresholdSecs / mid) * 100, [77.5, 87.7, 94.3, 100, 103.4])) : 2;
    case "rpe":
      return Math.min(6, band(mid, [2, 4, 6, 7, 8]));
    default:
      return sport === "rest" ? 1 : 1;
  }
}

// Minutes a step takes: its minutes, or distance at a sensible pace.
function stepMinutes(step: Step, sport: string, thresholdSecs: number | null): number {
  if (step.minutes !== null) return step.minutes;
  if (step.distance_m === null) return 0;
  if (sport === "swim") return (step.distance_m / 100) * ((thresholdSecs ?? 125) * 1.1) / 60;
  return (step.distance_m / 1000) * ((thresholdSecs ?? 330) * 1.15) / 60;
}

interface Block {
  minutes: number;
  zone: number;
  rest: boolean;
}

export function workoutBlocks(plan: StoredPlan, thresholds: Metrics["thresholds"] | null | undefined): Block[] {
  const th = plan.sport === "swim" ? thresholds?.swim.threshold : plan.sport === "run" ? thresholds?.run.threshold : null;
  const thresholdSecs = th ? parseSecs(th) : null;
  const out: Block[] = [];
  for (const s of plan.steps) {
    const reps = s.reps && s.reps > 1 ? s.reps : 1;
    const m = stepMinutes(s, plan.sport, thresholdSecs);
    const z = zoneOf(s, plan.sport, thresholdSecs);
    for (let i = 0; i < reps; i++) {
      out.push({ minutes: m, zone: z, rest: false });
      if (s.rest_seconds && s.rest_seconds > 0) out.push({ minutes: s.rest_seconds / 60, zone: 1, rest: true });
    }
  }
  return out.filter((b) => b.minutes > 0);
}

export function WorkoutChart({ plan, thresholds }: { plan: StoredPlan; thresholds: Metrics["thresholds"] | null | undefined }) {
  const blocks = workoutBlocks(plan, thresholds);
  if (blocks.length === 0) return null;
  const total = blocks.reduce((a, b) => a + b.minutes, 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(total * f));
  return (
    <figure style={{ margin: 0 }}>
      <div className="wchart" role="img" aria-label={`Workout profile, ${Math.round(total)} minutes, highest zone ${Math.max(...blocks.map((b) => b.zone))}`}>
        <span className="ylab" style={{ top: "0%" }}>
          Z6
        </span>
        <span className="ylab" style={{ top: "50%" }}>
          Z3
        </span>
        <span className="ylab" style={{ top: "83%" }}>
          Z1
        </span>
        <div className="grid-line" style={{ top: "50%" }} />
        <div className="grid-line" style={{ top: "83%" }} />
        <div className="bars" aria-hidden>
          {blocks.map((b, i) => (
            <div
              key={i}
              style={{
                flex: b.minutes,
                height: `${Math.max(12, (b.zone / 6) * 100)}%`,
                background: ZONE_COLORS[b.zone],
                opacity: b.rest ? 0.45 : 1,
              }}
            />
          ))}
        </div>
      </div>
      <div className="xaxis" aria-hidden>
        {ticks.map((t, i) => (
          <span key={i}>{i === ticks.length - 1 ? `${t}′` : t}</span>
        ))}
      </div>
    </figure>
  );
}

// Fitness (CTL), fatigue (ATL) and form (TSB) over the last weeks.
export function TrendChart({ trend }: { trend: NonNullable<Metrics["trend"]> }) {
  const pts = trend.filter((p) => p.ctl !== null && p.atl !== null) as { date: string; ctl: number; atl: number }[];
  if (pts.length < 3) return <p className="small muted">Not enough history yet. Fitness and fatigue need a few weeks of sessions.</p>;
  const W = 340;
  const H = 110;
  const tsb = pts.map((p) => p.ctl - p.atl);
  const lo = Math.min(0, ...tsb, ...pts.map((p) => p.ctl), ...pts.map((p) => p.atl));
  const hi = Math.max(10, ...pts.map((p) => p.ctl), ...pts.map((p) => p.atl), ...tsb);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * (H - 8) - 4;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <>
      <svg
        role="img"
        aria-label={`Fitness ${Math.round(last.ctl)}, fatigue ${Math.round(last.atl)}, form ${Math.round(last.ctl - last.atl)}`}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="3 3" />
        <polyline points={line(pts.map((p) => p.ctl))} fill="none" stroke="#2563EB" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <polyline points={line(pts.map((p) => p.atl))} fill="none" stroke="#DB2777" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={line(tsb)} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="row small mono" style={{ gap: 14, marginTop: 6 }}>
        <span style={{ color: "#2563EB" }}>━ Fitness {Math.round(last.ctl)}</span>
        <span style={{ color: "#DB2777" }}>━ Fatigue {Math.round(last.atl)}</span>
        <span style={{ color: "var(--accent)" }}>━ Form {Math.round(last.ctl - last.atl)}</span>
      </div>
    </>
  );
}

// Load per day, Monday to Sunday of this week, coloured by the day's main sport.
export function WeekLoad({ date, activities }: { date: string; activities: ActivitySummary[] }) {
  const [y, m, d] = date.split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(monday);
    t.setUTCDate(monday.getUTCDate() + i);
    const iso = t.toISOString().slice(0, 10);
    const acts = activities.filter((a) => a.date === iso);
    const load = acts.reduce((s, a) => s + (a.load ?? 0), 0);
    const main = [...acts].sort((a, b) => (b.load ?? 0) - (a.load ?? 0))[0];
    return { iso, load, sport: main?.sport ?? null, isToday: iso === date };
  });
  const max = Math.max(60, ...days.map((x) => x.load));
  const total = days.reduce((s, x) => s + x.load, 0);
  const color = (s: string | null) => (s === "swim" ? "var(--swim)" : s === "bike" ? "var(--bike)" : s === "run" ? "var(--run)" : "var(--other)");
  return (
    <>
      <div className="spread">
        <span className="label">Week load</span>
        <span className="mono small muted">{Math.round(total)} load</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, alignItems: "end", height: 70, marginTop: 10 }}>
        {days.map((x) => (
          <div
            key={x.iso}
            title={`${x.iso}: load ${Math.round(x.load)}`}
            style={{
              height: `${Math.max(4, (x.load / max) * 100)}%`,
              background: x.load ? color(x.sport) : "var(--line)",
              borderRadius: 3,
              outline: x.isToday ? "2px solid var(--text)" : "none",
              outlineOffset: 1,
            }}
          />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, textAlign: "center", marginTop: 6 }} className="small muted">
        {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
          <span key={i} style={days[i].isToday ? { color: "var(--text)", fontWeight: 700 } : undefined}>
            {l}
          </span>
        ))}
      </div>
    </>
  );
}
