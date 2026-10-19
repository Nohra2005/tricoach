// Small presentational components shared by the screens.
import type { Flag, Metrics, Plan } from "../../shared/schemas";

export function fmt(v: number | null | undefined, unit = "", dp = 0): string {
  if (v === null || v === undefined) return "no data";
  const n = dp === 0 ? Math.round(v) : Math.round(v * 10 ** dp) / 10 ** dp;
  return `${n}${unit ? " " + unit : ""}`;
}

export function hoursMinutes(h: number | null): string {
  if (h === null) return "no data";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

type Baseline = Metrics["baselines"]["hrv"];

export function MetricCard(props: {
  label: string;
  value: number | null;
  display: string;
  baseline: Baseline;
  flag: Flag | undefined;
  unit: string;
  dp?: number;
}) {
  const { label, value, display, baseline: b, flag, unit, dp = 0 } = props;
  const hasRange = b.mean28 !== null && b.sd28 !== null && b.n28 >= 10;
  let band: { left: number; width: number; dot: number } | null = null;
  if (hasRange && value !== null) {
    const low = b.mean28! - b.sd28!;
    const high = b.mean28! + b.sd28!;
    const min = Math.min(low - b.sd28!, value);
    const max = Math.max(high + b.sd28!, value);
    const pct = (x: number) => ((x - min) / (max - min || 1)) * 100;
    band = { left: pct(low), width: pct(high) - pct(low), dot: pct(value) };
  }
  return (
    <div className={`card${flag ? " flag" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{display}</div>
      {band && (
        <div className="range" aria-hidden>
          <div className="range-band" style={{ left: `${band.left}%`, width: `${band.width}%` }} />
          <div className="range-dot" style={{ left: `${band.dot}%` }} />
        </div>
      )}
      <div className="small muted">7-day avg {fmt(b.mean7, unit, dp)}</div>
      <div className="small muted">28-day avg {fmt(b.mean28, unit, dp)}</div>
      {hasRange ? (
        <div className="small muted">
          Normal range {fmt(b.mean28! - b.sd28!, "", dp)} to {fmt(b.mean28! + b.sd28!, unit, dp)}
        </div>
      ) : (
        <div className="small muted">Not enough data for a range ({b.n28} of 10 days)</div>
      )}
      {flag && <div className="flag-text">{flag.direction === "below" ? "Below" : "Above"} your normal range</div>}
    </div>
  );
}

export function IntensityBadge({ intensity }: { intensity: Plan["intensity"] }) {
  return <span className={`badge ${intensity}`}>{intensity}</span>;
}

export function PlanView({ plan }: { plan: Plan }) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <IntensityBadge intensity={plan.intensity} />
        <span className="muted small">
          {plan.sport} · {plan.total_minutes} min
        </span>
      </div>
      <h2 style={{ marginTop: 8 }}>{plan.title}</h2>
      {plan.steps.length > 0 && (
        <ol className="steps">
          {plan.steps.map((s, i) => (
            <li key={i}>
              <div className="step-head">
                <span>
                  {s.reps && s.reps > 1 ? `${s.reps} x ` : ""}
                  {s.label}
                </span>
                <span className="muted">
                  {s.distance_m !== null ? `${s.distance_m} m` : s.minutes !== null ? `${s.minutes} min` : ""}
                </span>
              </div>
              <div>{s.target}</div>
              {s.notes && <div className="small muted">{s.notes}</div>}
            </li>
          ))}
        </ol>
      )}
      <h3 style={{ marginTop: 14 }}>Why</h3>
      <p>{plan.why}</p>
      <h3>If you feel worse once you start</h3>
      <p>{plan.easier_option}</p>
      {plan.warnings.length > 0 && (
        <div className="card notice" style={{ margin: "10px 0 0" }}>
          <h3>Watch for</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TapScale(props: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  max?: number;
  low?: string;
  high?: string;
}) {
  const { label, value, onChange, max = 5, low, high } = props;
  return (
    <div style={{ margin: "14px 0" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{label}</strong>
        {low && high && (
          <span className="small muted">
            1 {low} · {max} {high}
          </span>
        )}
      </div>
      <div className="scale" style={{ gridTemplateColumns: `repeat(${max}, 1fr)`, marginTop: 6 }}>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={value === n ? "selected" : ""}
            onClick={() => onChange(n)}
            aria-pressed={value === n}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  return message ? (
    <div className="card error" role="alert">
      {message}
    </div>
  ) : null;
}
