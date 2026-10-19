import { useCallback, useEffect, useState } from "react";
import type { CheckIn, DayRecord, Feedback, Metrics, TodayResponse } from "../../shared/schemas";
import { ApiError, api, localDate, waitForJob } from "../api";
import { ErrorBox, MetricCard, PlanView, fmt, hoursMinutes } from "../components/ui";
import { load, save } from "../storage";
import { CheckInForm } from "./CheckIn";
import { FeedbackForm } from "./FeedbackForm";

interface Cached {
  savedAt: string;
  data: TodayResponse;
}

function minutesText(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)} min`;
}

function dayLabel(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function YourNumbers({ m }: { m: Metrics }) {
  const t = m.thresholds;
  const ty = m.typical;
  if (!t && !ty) return null;
  const sports = [
    ["swim", "Swim"],
    ["bike", "Bike"],
    ["run", "Run"],
  ] as const;
  return (
    <>
      <h2>Your numbers</h2>
      <p className="small muted">What the coach uses for targets. Typed values in Settings override intervals.icu.</p>
      {sports.map(([k, label]) => {
        const s = t?.[k];
        const typ = ty?.[k];
        return (
          <details className="card" key={k}>
            <summary>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{label}</strong>
                <span className="small muted">
                  {s?.threshold ?? "no threshold set"}
                  {s?.threshold_source ? ` · ${s.threshold_source}` : ""}
                </span>
              </div>
              {typ && typ.sessions > 0 && (
                <div className="small muted">
                  Last {ty!.days} days: {typ.sessions} sessions
                  {typ.median_pace ? `, typical ${typ.median_pace}` : ""}
                  {typ.median_avg_watts !== null ? `, typical ${typ.median_avg_watts} W` : ""}
                  {typ.median_avg_hr !== null ? `, HR ${typ.median_avg_hr}` : ""}
                </div>
              )}
            </summary>
            {s && (s.lthr !== null || s.max_hr !== null) && (
              <p className="small">
                Threshold HR {fmt(s.lthr, "bpm")} · Max HR {fmt(s.max_hr, "bpm")}
                {s.indoor_ftp ? ` · Indoor FTP ${s.indoor_ftp} W` : ""}
              </p>
            )}
            {typ?.middle_half && <p className="small">Middle half of your sessions: {typ.middle_half}</p>}
            {s && s.work_zones.length > 0 && (
              <>
                <h3>{k === "bike" ? "Power zones" : "Pace zones"}</h3>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {s.work_zones.map((z) => (
                    <li key={z}>{z}</li>
                  ))}
                </ul>
              </>
            )}
            {s && s.hr_zones.length > 0 && (
              <>
                <h3 style={{ marginTop: 8 }}>Heart rate zones</h3>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {s.hr_zones.map((z) => (
                    <li key={z}>{z}</li>
                  ))}
                </ul>
              </>
            )}
            {s && s.work_zones.length === 0 && s.hr_zones.length === 0 && (
              <p className="small muted">No zones in intervals.icu for this sport. Set them in intervals.icu Settings, or add a threshold in TriCoach Settings.</p>
            )}
          </details>
        );
      })}
      {t?.notes.map((n) => (
        <p key={n} className="small muted">
          {n}
        </p>
      ))}
    </>
  );
}

function Readiness({ m }: { m: Metrics }) {
  const flag = (k: string) => m.flags.find((f) => f.metric === k);
  const last = (k: "hrv" | "resting_hr" | "sleep_hours", show: (v: number) => string) => {
    const l = m.latest?.[k];
    return l && l.date !== m.date ? `${show(l.value)} on ${dayLabel(l.date)}` : null;
  };
  return (
    <>
      <div className="grid">
        <MetricCard
          label="HRV"
          value={m.today.hrv}
          display={fmt(m.today.hrv, "ms")}
          baseline={m.baselines.hrv}
          flag={flag("hrv")}
          unit="ms"
          lastText={last("hrv", (v) => fmt(v, "ms"))}
        />
        <MetricCard
          label="Resting HR"
          value={m.today.resting_hr}
          display={fmt(m.today.resting_hr, "bpm")}
          baseline={m.baselines.resting_hr}
          flag={flag("resting_hr")}
          unit="bpm"
          lastText={last("resting_hr", (v) => fmt(v, "bpm"))}
        />
        <MetricCard
          label="Sleep last night"
          value={m.today.sleep_hours}
          display={hoursMinutes(m.today.sleep_hours)}
          baseline={m.baselines.sleep_hours}
          flag={flag("sleep_hours")}
          unit="h"
          dp={1}
          lastText={last("sleep_hours", (v) => hoursMinutes(v))}
        />
        <div className="card">
          <div className="metric-label">Form (TSB)</div>
          <div className="metric-value">{fmt(m.today.tsb, "", 1)}</div>
          <div className="small muted">Fitness (CTL) {fmt(m.today.ctl, "", 1)}</div>
          <div className="small muted">Fatigue (ATL) {fmt(m.today.atl, "", 1)}</div>
          <div className="small muted">Form = fitness minus fatigue</div>
        </div>
      </div>
      {m.flags.length > 0 && (
        <div className="card flag">
          {m.flags.map((f) => (
            <p key={f.metric} className="small">
              {f.rule}
            </p>
          ))}
        </div>
      )}
      <details className="small muted" style={{ margin: "6px 0" }}>
        <summary>How flags work</summary>
        <p>{m.flag_rule}</p>
      </details>

      <h2>Last 7 days</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Sport</th>
              <th className="num">Sessions</th>
              <th className="num">Time</th>
              <th className="num">Load</th>
            </tr>
          </thead>
          <tbody>
            {(["swim", "bike", "run", "other"] as const).map((s) => (
              <tr key={s}>
                <td style={{ textTransform: "capitalize" }}>{s}</td>
                <td className="num">{m.last7[s].sessions}</td>
                <td className="num">{m.last7[s].sessions ? minutesText(m.last7[s].minutes) : "-"}</td>
                <td className="num">{m.last7[s].sessions ? Math.round(m.last7[s].load) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ color: "var(--accent)" }}>
            Sessions in the last 14 days ({m.activities14.length})
          </summary>
          <ul className="steps">
            {m.activities14.map((a) => (
              <li key={a.id} className="small">
                <div className="step-head">
                  <span>
                    {a.date} · {a.type}
                    {a.hard ? " · hard" : ""}
                  </span>
                  <span className="muted">{a.minutes === null ? "no data" : `${a.minutes} min`}</span>
                </div>
                <div className="muted">
                  {a.distance_km !== null ? `${a.distance_km} km · ` : ""}
                  load {fmt(a.load)} · HR {fmt(a.avg_hr)}
                  {a.avg_watts !== null ? ` · ${a.avg_watts} W` : ""}
                  {a.pace_per_100m ? ` · ${a.pace_per_100m}/100m` : ""}
                  {a.pace_per_km ? ` · ${a.pace_per_km}/km` : ""}
                </div>
              </li>
            ))}
          </ul>
        </details>
      </div>
      {m.hidden_activities > 0 && (
        <div className="card notice small">
          {m.hidden_activities} recent activities came into intervals.icu from Strava, and intervals.icu cannot share those through
          its API. Link Garmin Connect to intervals.icu directly so they show here.
        </div>
      )}
    </>
  );
}

function lastGenerationError(day: DayRecord): string | null {
  const last = [...day.events].reverse().find((e) => e.type === "generate" || e.type === "generate_failed");
  return last?.type === "generate_failed" ? last.detail : null;
}

export function Today() {
  const date = localDate();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const [editCheckin, setEditCheckin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.today(date);
      setData(d);
      setOfflineSince(null);
      save("lastToday", { savedAt: new Date().toISOString(), data: d } satisfies Cached);
    } catch (e) {
      const cached = load<Cached>("lastToday");
      if (cached) {
        setData(cached.data);
        setOfflineSince(cached.savedAt);
      }
      if (!(e instanceof ApiError && e.status === 0 && cached)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generate() {
    setError(null);
    setGenerating(0);
    try {
      const { jobId } = await api.generate(date);
      const job = await waitForJob(jobId, setGenerating);
      if (job.status === "error") setError(job.error ?? "Generation failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }

  async function submitCheckin(c: CheckIn) {
    setBusy(true);
    setError(null);
    try {
      const { day } = await api.checkin(date, c);
      setData((d) => (d ? { ...d, day } : d));
      setEditCheckin(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    await generate();
  }

  async function submitFeedback(f: Feedback) {
    setBusy(true);
    setError(null);
    try {
      const { day, matchError } = await api.feedback(date, f);
      setData((d) => (d ? { ...d, day } : d));
      if (matchError) setError(`Feedback saved. Could not check intervals.icu for the activity: ${matchError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const day = data?.day;
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <main>
      <h1>Today</h1>
      <p className="muted">{weekday}</p>
      {offlineSince && (
        <div className="card notice small">Offline. Showing data saved {new Date(offlineSince).toLocaleString()}.</div>
      )}
      <ErrorBox message={error} />
      {loading && !data && (
        <div className="row">
          <div className="spinner" /> <span className="muted">Loading your data...</span>
        </div>
      )}

      {data && day && (
        <>
          {generating !== null ? (
            <div className="card row">
              <div className="spinner" />
              <span>Writing today's session... {generating > 0 ? `${generating}s` : ""}</span>
            </div>
          ) : day.plan && !editCheckin ? (
            <>
              <PlanView plan={day.plan} />
              {day.feedback ? (
                <div className="card">
                  <h3>Your feedback</h3>
                  <p>
                    {day.feedback.followed.replace("_", " ")}
                    {day.feedback.reason ? `: ${day.feedback.reason}` : ""}
                  </p>
                  <p className="small muted">
                    RPE {fmt(day.feedback.rpe)} · feeling {fmt(day.feedback.feel)}/5
                  </p>
                  {day.matched_activity ? (
                    <p className="small">
                      Recorded: {day.matched_activity.type}, {fmt(day.matched_activity.minutes, "min")}, load{" "}
                      {fmt(day.matched_activity.load)}
                    </p>
                  ) : (
                    <p className="small muted">No activity from intervals.icu matched yet. History can check again later.</p>
                  )}
                </div>
              ) : (
                !offlineSince && <FeedbackForm busy={busy} onSubmit={submitFeedback} />
              )}
              {!offlineSince && !day.feedback && (
                <button className="link" onClick={() => setEditCheckin(true)}>
                  Change check-in and rewrite the session
                </button>
              )}
            </>
          ) : day.checkin && !editCheckin ? (
            <div className="card">
              <p>Check-in saved.</p>
              {lastGenerationError(day) && <ErrorBox message={`Last attempt failed: ${lastGenerationError(day)}`} />}
              <button className="primary" onClick={generate} disabled={!!offlineSince}>
                Write today's session
              </button>
              <button className="link" onClick={() => setEditCheckin(true)}>
                Edit check-in
              </button>
            </div>
          ) : (
            !offlineSince && <CheckInForm initial={day.checkin} busy={busy} onSubmit={submitCheckin} />
          )}
          {editCheckin && (
            <button className="link" onClick={() => setEditCheckin(false)}>
              Cancel
            </button>
          )}

          <h2>Readiness</h2>
          <Readiness m={data.metrics} />
          <YourNumbers m={data.metrics} />
        </>
      )}
    </main>
  );
}
