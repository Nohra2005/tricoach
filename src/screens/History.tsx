import { useEffect, useState } from "react";
import type { DayRecord } from "../../shared/schemas";
import { api } from "../api";
import { WorkoutChart } from "../components/charts";
import { ErrorBox, SPORT_NAME, dayLabel, fmt, hm, sportKey } from "../components/ui";

const FOLLOWED: Record<string, string> = { as_planned: "Done", modified: "Modified", skipped: "Skipped" };

function Outcome({ d }: { d: DayRecord }) {
  if (d.feedback) {
    const cls = d.feedback.followed === "as_planned" ? "ok" : d.feedback.followed === "skipped" ? "hard" : "warn";
    return <span className={`chip ${cls}`}>{FOLLOWED[d.feedback.followed]}</span>;
  }
  if (d.matched_activity) return <span className="chip ok">Recorded</span>;
  return d.plan ? <span className="chip">No feedback</span> : null;
}

function DayRow({ d }: { d: DayRecord }) {
  const m = d.metrics?.today;
  const p = d.plan;
  return (
    <details className="panel" style={{ padding: 0 }}>
      <summary style={{ padding: "12px 14px", display: "block" }}>
        <div className="spread">
          <span className="row" style={{ gap: 8 }}>
            <span className={`sport-dot ${p ? sportKey(p.sport) : ""}`} />
            <span className="mono small muted">{dayLabel(d.date)}</span>
          </span>
          <Outcome d={d} />
        </div>
        <div style={{ fontWeight: 600, marginTop: 4 }}>{p ? p.title : d.checkin ? "Check-in only, no session" : "No check-in"}</div>
        <div className="small muted mono">
          {p ? `${SPORT_NAME[p.sport]} · ${p.total_minutes} min · ${p.intensity}` : ""}
          {d.feedback?.rpe ? ` · RPE ${d.feedback.rpe}` : ""}
          {d.matched_activity ? ` · did ${fmt(d.matched_activity.minutes, " min")}` : ""}
        </div>
      </summary>
      <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {p && p.steps.length > 0 && <WorkoutChart plan={p} thresholds={d.metrics?.thresholds ?? null} />}
        <table className="t">
          <tbody>
            <tr>
              <td className="muted">Watch</td>
              <td className="mono">
                {m
                  ? `HRV ${fmt(m.hrv)} · RHR ${fmt(m.resting_hr)} · sleep ${hm(m.sleep_hours)} · TSB ${fmt(m.tsb, "", 1)}`
                  : "no data"}
                {d.metrics && d.metrics.flags.length > 0 && (
                  <div className="small" style={{ color: "var(--warn)" }}>
                    {d.metrics.flags.map((f) => `${f.label} ${f.direction}`).join(", ")}
                  </div>
                )}
              </td>
            </tr>
            <tr>
              <td className="muted">Check-in</td>
              <td>
                {d.checkin ? (
                  <>
                    Energy {d.checkin.energy} · soreness {d.checkin.soreness} · {d.checkin.minutes} min · {d.checkin.locations.join(", ")}
                    {d.checkin.pool_length ? ` · ${d.checkin.pool_length} m pool` : ""}
                    {d.checkin.pain ? <div className="small" style={{ color: "var(--warn)" }}>Pain/illness: {d.checkin.pain}</div> : null}
                  </>
                ) : (
                  <span className="muted">none</span>
                )}
              </td>
            </tr>
            {p && (
              <tr>
                <td className="muted">Rationale</td>
                <td>
                  {p.why}
                  {d.previous_plans.length > 0 && <div className="small muted">Rewritten {d.previous_plans.length} time(s) that day.</div>}
                </td>
              </tr>
            )}
            <tr>
              <td className="muted">Feedback</td>
              <td>
                {d.feedback ? (
                  <>
                    {FOLLOWED[d.feedback.followed]}
                    {d.feedback.reason ? `: ${d.feedback.reason}` : ""} · RPE {fmt(d.feedback.rpe)} · felt {fmt(d.feedback.feel)}/5
                    {d.feedback.notes ? <div className="small muted">{d.feedback.notes}</div> : null}
                  </>
                ) : (
                  <span className="muted">none</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="muted">Recorded</td>
              <td>
                {d.matched_activity ? (
                  <>
                    {d.matched_activity.type}, {fmt(d.matched_activity.minutes, " min")}
                    {d.matched_activity.distance_km !== null ? `, ${d.matched_activity.distance_km} km` : ""} · load {fmt(d.matched_activity.load)} · HR{" "}
                    {fmt(d.matched_activity.avg_hr)}
                    <div className="small muted">Matched by {d.matched_activity.match_rule}.</div>
                  </>
                ) : (
                  <span className="muted">no matched activity</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        {d.generation && (
          <p className="small muted mono">
            {d.generation.answered_by ?? d.generation.model} · prompt {d.generation.prompt_version} · {d.generation.attempts.length} attempt(s) ·{" "}
            {Math.round(d.generation.latency_ms / 1000)} s · {d.generation.input_tokens + d.generation.output_tokens} tokens
          </p>
        )}
      </div>
    </details>
  );
}

export function History() {
  const [days, setDays] = useState<DayRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setDays((await api.history()).days);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const withPlan = days?.filter((d) => d.plan) ?? [];
  const answered = withPlan.filter((d) => d.feedback);
  const done = answered.filter((d) => d.feedback!.followed === "as_planned").length;
  const modified = answered.filter((d) => d.feedback!.followed === "modified").length;
  const skipped = answered.filter((d) => d.feedback!.followed === "skipped").length;

  return (
    <main>
      <header className="band">
        <div className="spread">
          <h1>History</h1>
          <div className="btn-row">
            <button disabled={busy} onClick={() => run(() => api.download("csv"))}>
              CSV
            </button>
            <button disabled={busy} onClick={() => run(() => api.download("json"))}>
              JSON
            </button>
          </div>
        </div>
        {days && days.length > 0 && (
          <div className="strip" style={{ marginTop: 12 }}>
            <div className="cell">
              <div className="label" style={{ fontSize: 10 }}>Sessions</div>
              <div className="v">{withPlan.length}</div>
            </div>
            <div className="cell">
              <div className="label" style={{ fontSize: 10 }}>Done</div>
              <div className="v">{done}</div>
            </div>
            <div className="cell">
              <div className="label" style={{ fontSize: 10 }}>Modified</div>
              <div className="v">{modified}</div>
            </div>
            <div className={`cell ${skipped ? "warn" : ""}`}>
              <div className="label" style={{ fontSize: 10 }}>Skipped</div>
              <div className="v">{skipped}</div>
            </div>
          </div>
        )}
      </header>
      <div className="page">
        <button
          className="link"
          style={{ alignSelf: "flex-start" }}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.match();
              setNote(`Checked ${r.checked} day(s) without a recorded activity; matched ${r.matched}.`);
              await refresh();
            })
          }
        >
          Look for recorded activities again
        </button>
        {note && <p className="small muted">{note}</p>}
        <ErrorBox message={error} />
        {days === null && !error && <div className="spinner" />}
        {days?.length === 0 && <p className="muted">Nothing yet. Your first check-in will show here.</p>}
        {days?.map((d) => (
          <DayRow key={d.date} d={d} />
        ))}
      </div>
    </main>
  );
}
