// Today's session in the Analytics style: header, workout profile, step table,
// rationale, easier option, and the Garmin send panel.
import { useState } from "react";
import type { DayRecord, Metrics, StoredPlan } from "../../shared/schemas";
import { WorkoutChart, workoutBlocks } from "./charts";
import { SPORT_NAME, sportKey } from "./ui";

const WATCHABLE = new Set(["swim", "bike", "run"]);

function amount(s: StoredPlan["steps"][number]) {
  if (s.distance_m !== null) return `${s.distance_m} m`;
  if (s.minutes !== null) {
    const secs = Math.round(s.minutes * 60);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  }
  return "";
}

function zoneText(s: StoredPlan["steps"][number]) {
  const t = s.target_spec;
  if (!t || t.low === null || t.high === null) return "";
  if (t.kind === "hr_zone") return t.low === t.high ? `Z${t.low}` : `Z${t.low}–${t.high}`;
  if (t.kind === "power_pct_ftp") return `${Math.round(t.low)}–${Math.round(t.high)}%`;
  if (t.kind === "rpe") return `RPE ${t.low === t.high ? t.low : `${t.low}–${t.high}`}`;
  return "";
}

export function SessionPanel(props: {
  day: DayRecord;
  metrics: Metrics;
  offline: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const { day, metrics, offline, sending, onSend } = props;
  const plan = day.plan!;
  const [easier, setEasier] = useState(false);
  const total = Math.round(workoutBlocks(plan, metrics.thresholds).reduce((a, b) => a + b.minutes, 0)) || plan.total_minutes;
  const indoor = day.checkin?.locations.includes("indoor_trainer") && !day.checkin.locations.includes("outdoor_bike");
  const where = plan.sport === "bike" ? (indoor ? "Indoor" : "Outdoor") : plan.sport === "swim" && day.checkin?.pool_length ? `${day.checkin.pool_length} m pool` : null;

  return (
    <section className="panel" aria-label="Today's session">
      <div className="spread" style={{ fontSize: 12, fontWeight: 700 }}>
        <span className="row" style={{ gap: 8 }}>
          <span className={`sport-dot ${sportKey(plan.sport)}`} />
          <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {SPORT_NAME[plan.sport]}
            {where ? ` · ${where}` : ""}
          </span>
          <span className={`chip ${plan.intensity === "hard" ? "hard" : plan.intensity === "moderate" ? "warn" : ""}`}>{plan.intensity}</span>
        </span>
        <span className="mono muted">{plan.total_minutes}:00</span>
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 700, margin: "8px 0 12px" }}>{plan.title}</h2>

      {plan.steps.length > 0 && (
        <>
          <WorkoutChart plan={plan} thresholds={metrics.thresholds} />
          <table className="t" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>STEP</th>
                <th>{plan.steps.some((s) => s.distance_m !== null) ? "AMOUNT" : "TIME"}</th>
                <th>TARGET</th>
                <th className="num">ZONE</th>
              </tr>
            </thead>
            <tbody>
              {plan.steps.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>
                    {s.reps && s.reps > 1 ? `${s.reps} × ` : ""}
                    {s.label}
                    {s.rest_seconds ? <div className="small muted">rest {s.rest_seconds} s</div> : null}
                    {s.notes && !s.rest_seconds ? <div className="small muted">{s.notes}</div> : null}
                  </td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{amount(s)}</td>
                  <td>{s.target}</td>
                  <td className="num mono" style={{ whiteSpace: "nowrap" }}>{zoneText(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {Math.abs(total - plan.total_minutes) > 5 && <p className="small muted" style={{ marginTop: 6 }}>About {total} min with rests.</p>}
        </>
      )}

      <p style={{ marginTop: 12, fontSize: 13 }}>
        <strong>Rationale.</strong> {plan.why}
      </p>
      {plan.warnings.length > 0 && (
        <div className="panel notice small" style={{ marginTop: 10 }}>
          <strong>Watch for:</strong> {plan.warnings.join(" ")}
        </div>
      )}
      {easier && (
        <div className="panel" style={{ marginTop: 10, background: "var(--surface-2)" }}>
          <div className="label">Easier option</div>
          <p style={{ marginTop: 4 }}>{plan.easier_option}</p>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        {WATCHABLE.has(plan.sport) && (
          <button type="button" className="primary" disabled={sending || offline || plan.steps.some((s) => s.target_spec === null)} onClick={onSend}>
            {sending ? "Sending..." : day.watch && !watchStale(day) ? "Send again" : "Send to Garmin"}
          </button>
        )}
        <button type="button" aria-pressed={easier} onClick={() => setEasier(!easier)}>
          {easier ? "Hide easier option" : "Easier option"}
        </button>
      </div>
      {WATCHABLE.has(plan.sport) && <WatchStatus day={day} />}
    </section>
  );
}

function watchStale(day: DayRecord): boolean {
  const w = day.watch;
  if (!w || !day.plan) return false;
  return w.plan_title !== day.plan.title || (day.generation ? w.sent_at < day.generation.finished_at : false);
}

function WatchStatus({ day }: { day: DayRecord }) {
  const w = day.watch;
  const legacy = day.plan!.steps.some((s) => s.target_spec === null);
  if (legacy) return <p className="small muted" style={{ marginTop: 8 }}>Written before watch support. Rewrite the session to send it.</p>;
  if (!w) return <p className="small muted" style={{ marginTop: 8 }}>Goes to your intervals.icu calendar, then Garmin. Sync your watch after sending.</p>;
  if (watchStale(day)) return <p className="small" style={{ marginTop: 8, color: "var(--warn)" }}>You rewrote the session after sending. Send again to update your watch.</p>;
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="small">
        <span style={{ color: w.parsed_ok === false ? "var(--warn)" : "var(--ok)", fontWeight: 600 }}>
          {w.simulated ? "● Demo: shown, not sent" : w.parsed_ok === false ? "● Sent as text only" : "● On your calendar"}
        </span>
        <span className="muted mono">
          {" "}
          {new Date(w.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {w.parsed_steps !== null ? ` · ${w.parsed_steps} steps` : ""}
        </span>{" "}
        <span className="muted" style={{ textDecoration: "underline" }}>
          what was sent
        </span>
      </summary>
      <pre>{w.text}</pre>
      {w.parsed_ok === false && <p className="small" style={{ color: "var(--warn)" }}>intervals.icu kept this as text, so the watch shows a note instead of steps.</p>}
      {day.plan!.sport === "swim" && <p className="small muted">Swims go to the watch as distances, repeats and rests. Garmin doesn't accept pace targets on pool steps.</p>}
    </details>
  );
}
