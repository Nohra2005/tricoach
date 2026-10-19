// Presentational components shared by the screens.
import type { ReactNode } from "react";
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

// ---------- sports ----------

type AnySport = Plan["sport"] | "swim" | "bike" | "run" | "other";

// CSS class that sets --sport / --sport-soft (swim purple, bike green, run red).
export function sportClass(sport: AnySport): string {
  if (sport === "swim") return "sport-swim";
  if (sport === "bike" || sport === "brick") return "sport-bike";
  if (sport === "run") return "sport-run";
  return "sport-other";
}

export const SPORT_NAME: Record<AnySport, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run",
  brick: "Brick",
  strength: "Strength",
  mobility: "Mobility",
  rest: "Rest",
  other: "Other",
};

// ---------- icons (inline SVG, stroke = currentColor) ----------

const ICONS: Record<string, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9.5 2.5h5" />
    </>
  ),
  history: <path d="M4 6h16M4 12h16M4 18h10" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
};

export function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------- metric tile ----------

type Baseline = Metrics["baselines"]["hrv"];

export function MetricTile(props: {
  label: string;
  value: number | null;
  display: string;
  unit?: string;
  baseline: Baseline;
  flag: Flag | undefined;
  dp?: number;
  lastText?: string | null; // most recent value when today has none, e.g. "41 ms on Sat 18 Oct"
}) {
  const { label, value, display, unit = "", baseline: b, flag, dp = 0, lastText } = props;
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
    <div className={`tile${flag ? " flag" : ""}`}>
      <div className="tile-label">{label}</div>
      {value === null ? (
        <>
          <div className="tile-value empty">No data today</div>
          <div className="small muted">{lastText ? `Last: ${lastText}` : "Nothing in the last 6 weeks"}</div>
        </>
      ) : (
        <div className="tile-value">
          {display}
          {unit && <small>{unit}</small>}
        </div>
      )}
      {band && (
        <div className="range" aria-hidden>
          <div className="range-band" style={{ left: `${band.left}%`, width: `${band.width}%` }} />
          <div className="range-dot" style={{ left: `${band.dot}%` }} />
        </div>
      )}
      {hasRange ? (
        <div className="small muted num">
          Normal {fmt(b.mean28! - b.sd28!, "", dp)} to {fmt(b.mean28! + b.sd28!, unit, dp)}
        </div>
      ) : (
        <div className="small muted">Range after 10 days ({b.n28} so far)</div>
      )}
      <div className="small muted num">
        7d {fmt(b.mean7, unit, dp)} · 28d {fmt(b.mean28, unit, dp)}
      </div>
      {flag && <div className="flag-text">{flag.direction === "below" ? "Below" : "Above"} your range</div>}
    </div>
  );
}

// ---------- session ----------

export function IntensityTag({ intensity }: { intensity: Plan["intensity"] }) {
  const cls = intensity === "hard" ? "intensity-hard" : intensity === "moderate" ? "intensity-moderate" : "neutral";
  return <span className={`tag ${cls}`}>{intensity}</span>;
}

export function SessionCard({ plan, children }: { plan: Plan; children?: ReactNode }) {
  return (
    <section className={`session ${sportClass(plan.sport)}`} aria-label="Today's session">
      <div className={`session-band${plan.sport === "brick" ? " brick" : ""}`}>
        <div className="spread">
          <div className="session-meta">
            <span>{SPORT_NAME[plan.sport]}</span>
            <span aria-hidden>·</span>
            <span>{plan.intensity}</span>
          </div>
          <div className="session-total">
            {plan.total_minutes}
            <small>min</small>
          </div>
        </div>
        <div className="session-title">{plan.title}</div>
      </div>
      <div className="session-body">
        {plan.steps.length > 0 && (
          <ol className="steps">
            {plan.steps.map((s, i) => (
              <li className="step" key={i}>
                <span className="step-rail" aria-hidden />
                <div>
                  <div className="step-label">
                    {s.reps && s.reps > 1 && <span className="step-reps">{s.reps} × </span>}
                    {s.label}
                  </div>
                  <div className="step-target">{s.target}</div>
                  {s.notes && <div className="small muted">{s.notes}</div>}
                </div>
                <div className="step-amount">
                  {s.distance_m !== null ? `${s.distance_m} m` : s.minutes !== null ? `${s.minutes}′` : ""}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="why">
          <div className="eyebrow muted">Why this session</div>
          <p style={{ marginBottom: 0 }}>{plan.why}</p>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow muted">Feeling worse once you start?</div>
          <p>{plan.easier_option}</p>
        </div>
        {plan.warnings.length > 0 && (
          <div className="card notice" style={{ margin: "8px 0 0" }}>
            <div className="eyebrow" style={{ color: "var(--warn)" }}>
              Watch for
            </div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

// ---------- inputs ----------

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
    <div className="question" role="group" aria-label={label}>
      <div className="question-head">
        <strong>{label}</strong>
        {low && high && (
          <span className="small muted">
            1 {low} · {max} {high}
          </span>
        )}
      </div>
      <div className="scale" style={{ gridTemplateColumns: `repeat(${max}, 1fr)` }}>
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
