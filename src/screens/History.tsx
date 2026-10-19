import { useEffect, useState } from "react";
import type { DayRecord } from "../../shared/schemas";
import { api } from "../api";
import { ErrorBox, IntensityBadge, PlanView, fmt, hoursMinutes } from "../components/ui";

function DayCard({ d }: { d: DayRecord }) {
  const m = d.metrics?.today;
  return (
    <details className="card">
      <summary>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>
            {d.weekday.slice(0, 3)} {d.date}
          </strong>
          {d.plan && <IntensityBadge intensity={d.plan.intensity} />}
        </div>
        <div>{d.plan ? d.plan.title : d.checkin ? "Check-in only, no plan" : "No check-in"}</div>
        <div className="small muted">
          {d.feedback
            ? `Did: ${d.feedback.followed.replace("_", " ")}${d.feedback.rpe ? `, RPE ${d.feedback.rpe}` : ""}`
            : d.plan
              ? "No feedback yet"
              : ""}
          {d.matched_activity ? ` · Recorded ${d.matched_activity.type} ${fmt(d.matched_activity.minutes, "min")}` : ""}
        </div>
      </summary>

      <h3 style={{ marginTop: 12 }}>Metrics</h3>
      {m ? (
        <p className="small">
          HRV {fmt(m.hrv, "ms")} · RHR {fmt(m.resting_hr, "bpm")} · Sleep {hoursMinutes(m.sleep_hours)} · CTL {fmt(m.ctl, "", 1)} ·
          ATL {fmt(m.atl, "", 1)} · TSB {fmt(m.tsb, "", 1)}
          {d.metrics!.flags.length > 0 && <> · Flags: {d.metrics!.flags.map((f) => `${f.label} ${f.direction}`).join(", ")}</>}
        </p>
      ) : (
        <p className="small muted">no data</p>
      )}

      <h3>Check-in</h3>
      {d.checkin ? (
        <p className="small">
          Energy {d.checkin.energy} · Soreness {d.checkin.soreness} · Motivation {d.checkin.motivation} · Stress{" "}
          {d.checkin.stress} · {d.checkin.minutes} min · {d.checkin.locations.join(", ")}
          {d.checkin.pain ? ` · Pain/illness: ${d.checkin.pain}` : ""}
        </p>
      ) : (
        <p className="small muted">none</p>
      )}

      {d.plan && (
        <>
          <h3>Recommended</h3>
          <PlanView plan={d.plan} />
          {d.previous_plans.length > 0 && <p className="small muted">Rewritten {d.previous_plans.length} time(s) that day.</p>}
        </>
      )}

      <h3>What happened</h3>
      {d.feedback ? (
        <p className="small">
          {d.feedback.followed.replace("_", " ")}
          {d.feedback.reason ? `: ${d.feedback.reason}` : ""} · RPE {fmt(d.feedback.rpe)} · Felt {fmt(d.feedback.feel)}/5
          {d.feedback.notes ? ` · ${d.feedback.notes}` : ""}
        </p>
      ) : (
        <p className="small muted">No feedback</p>
      )}
      {d.matched_activity ? (
        <p className="small">
          intervals.icu: {d.matched_activity.type}, {fmt(d.matched_activity.minutes, "min")}
          {d.matched_activity.distance_km !== null ? `, ${d.matched_activity.distance_km} km` : ""}, load{" "}
          {fmt(d.matched_activity.load)}, HR {fmt(d.matched_activity.avg_hr)}. Match: {d.matched_activity.match_rule}.
        </p>
      ) : (
        <p className="small muted">No matched activity</p>
      )}
      {d.generation && (
        <p className="small muted">
          {d.generation.answered_by ?? d.generation.model} · prompt {d.generation.prompt_version} · {d.generation.attempts.length}{" "}
          attempt(s) · {Math.round(d.generation.latency_ms / 1000)}s · {d.generation.input_tokens + d.generation.output_tokens} tokens
        </p>
      )}
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

  return (
    <main>
      <h1>History</h1>
      <div className="row">
        <button disabled={busy} onClick={() => run(() => api.download("csv"))}>
          Export CSV
        </button>
        <button disabled={busy} onClick={() => run(() => api.download("json"))}>
          Export JSON
        </button>
      </div>
      <button
        className="link"
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
      {days?.map((d) => <DayCard key={d.date} d={d} />)}
    </main>
  );
}
