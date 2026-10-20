import { useCallback, useEffect, useState } from "react";
import { WEEKDAYS, type CheckIn, type DayRecord, type Feedback, type Metrics, type Settings, type TodayResponse } from "../../shared/schemas";
import { ApiError, api, localDate, waitForJob } from "../api";
import { TrendChart, WeekLoad } from "../components/charts";
import { SessionPanel } from "../components/session";
import { ErrorBox, SPORT_NAME, dayLabel, fmt, hm, sportKey } from "../components/ui";
import { load, save } from "../storage";
import { CheckInForm } from "./CheckIn";
import { FeedbackForm } from "./FeedbackForm";

interface Cached {
  savedAt: string;
  data: TodayResponse;
}

// The readiness strip: each measured signal against its 28-day range (1 SD rule).
function Strip({ m }: { m: Metrics }) {
  const flag = (k: string) => m.flags.find((f) => f.metric === k);
  const range = (b: Metrics["baselines"]["hrv"], dp = 0) =>
    b.mean28 !== null && b.sd28 !== null && b.n28 >= 10 ? `${fmt(b.mean28 - b.sd28, "", dp)}–${fmt(b.mean28 + b.sd28, "", dp)}` : `range at 10 d (${b.n28})`;
  const cell = (label: string, value: string | null, k: "hrv" | "resting_hr" | "sleep_hours", r: string) => {
    const f = flag(k);
    const cls = value === null ? "cell none" : f ? "cell warn" : "cell";
    return (
      <div className={cls}>
        <div className="label" style={{ fontSize: 10 }}>
          {label}
        </div>
        <div className="v">{value ?? "—"}</div>
        <div className="r">{value === null ? "no data today" : f ? `${f.direction} range` : r}</div>
      </div>
    );
  };
  return (
    <div className="strip">
      {cell("HRV", m.today.hrv === null ? null : fmt(m.today.hrv), "hrv", range(m.baselines.hrv))}
      {cell("RHR", m.today.resting_hr === null ? null : fmt(m.today.resting_hr), "resting_hr", range(m.baselines.resting_hr))}
      {cell("Sleep", m.today.sleep_hours === null ? null : hm(m.today.sleep_hours), "sleep_hours", range(m.baselines.sleep_hours, 1))}
      <div className={m.today.tsb === null ? "cell none" : "cell"}>
        <div className="label" style={{ fontSize: 10 }}>
          Form
        </div>
        <div className="v">{m.today.tsb === null ? "—" : fmt(m.today.tsb)}</div>
        <div className="r">{m.today.ctl === null ? "needs sessions" : `${fmt(m.today.ctl)}/${fmt(m.today.atl)}`}</div>
      </div>
    </div>
  );
}

function readinessCount(m: Metrics) {
  const signals = (["hrv", "resting_hr", "sleep_hours"] as const).filter((k) => m.today[k] !== null);
  const ok = signals.filter((k) => !m.flags.some((f) => f.metric === k)).length;
  return { ok, of: signals.length };
}

function lastGenerationError(day: DayRecord): string | null {
  const last = [...day.events].reverse().find((e) => e.type === "generate" || e.type === "generate_failed");
  return last?.type === "generate_failed" ? last.detail : null;
}

function Sessions14({ m }: { m: Metrics }) {
  return (
    <section className="panel" aria-label="Sessions in the last 14 days">
      <div className="spread">
        <span className="label">Last 14 days</span>
        <span className="mono small muted">{m.activities14.length} sessions</span>
      </div>
      {m.activities14.length === 0 ? (
        <p className="small muted">Nothing from intervals.icu yet.</p>
      ) : (
        <table className="t">
          <tbody>
            {m.activities14.slice(0, 10).map((a) => (
              <tr key={a.id}>
                <td style={{ width: 16 }}>
                  <span className={`sport-dot ${sportKey(a.sport)}`} style={{ display: "inline-block", marginTop: 4 }} />
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {dayLabel(a.date)} · {a.type}
                    {a.hard ? " · hard" : ""}
                  </div>
                  <div className="small muted mono">
                    {a.distance_km !== null ? `${a.distance_km} km · ` : ""}load {fmt(a.load)} · HR {fmt(a.avg_hr)}
                    {a.avg_watts !== null ? ` · ${a.avg_watts} W` : ""}
                    {a.pace_per_100m ? ` · ${a.pace_per_100m}/100m` : ""}
                    {a.pace_per_km ? ` · ${a.pace_per_km}/km` : ""}
                  </div>
                </td>
                <td className="num mono">{a.minutes === null ? "—" : `${a.minutes}′`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.hidden_activities > 0 && (
        <p className="small" style={{ color: "var(--warn)", marginTop: 8 }}>
          {m.hidden_activities} activities came from Strava and can't be read. Link Garmin to intervals.icu directly.
        </p>
      )}
    </section>
  );
}

export function Today() {
  const date = localDate();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const [editCheckin, setEditCheckin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api.today(date), api.settings().catch(() => null)]);
      setData(d);
      if (s) setSettings(s);
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

  async function sendToWatch() {
    setSending(true);
    setError(null);
    try {
      const { day } = await api.sendWorkout(date);
      setData((d) => (d ? { ...d, day } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const day = data?.day;
  const m = data?.metrics;
  const weekdayName = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const todayPlan = settings?.schedule[weekdayName];
  const rc = m ? readinessCount(m) : null;
  const heading = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const nextRace = settings?.races.find((r) => r.priority === "A") ?? settings?.races[0];

  return (
    <main>
      <header className="band">
        <div className="spread">
          <div>
            <div className="label">
              {heading}
              {settings ? ` · ${settings.phase.replace("_", " ")}` : ""}
              {nextRace?.name ? ` · ${nextRace.name}` : ""}
            </div>
            <h1>Today</h1>
          </div>
          {rc && rc.of > 0 && (
            <div style={{ textAlign: "right" }}>
              <div className="label" style={{ fontSize: 10 }}>
                Readiness
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: rc.ok === rc.of ? "var(--accent)" : "var(--warn)" }}>
                {rc.ok}/{rc.of} OK
              </div>
            </div>
          )}
        </div>
        {m && <Strip m={m} />}
      </header>

      <div className="page">
        {offlineSince && <div className="panel notice small">Offline. Showing data saved {new Date(offlineSince).toLocaleString()}.</div>}
        <ErrorBox message={error} />
        {loading && !data && (
          <div className="row">
            <div className="spinner" />
            <span className="muted">Loading your data...</span>
          </div>
        )}

        {data && day && m && (
          <div className="split">
            <div className="col">
              {generating !== null ? (
                <div className="panel row" role="status">
                  <div className="spinner" />
                  <strong>Writing today's session</strong>
                  <span className="mono muted">{generating > 0 ? `${generating}s` : ""}</span>
                </div>
              ) : day.plan && !editCheckin ? (
                <>
                  <SessionPanel day={day} metrics={m} offline={!!offlineSince} sending={sending} onSend={sendToWatch} />
                  {day.feedback ? (
                    <section className="panel">
                      <span className="label">Your feedback</span>
                      <p style={{ marginTop: 6, fontWeight: 600, textTransform: "capitalize" }}>
                        {day.feedback.followed.replace("_", " ")}
                        <span style={{ textTransform: "none", fontWeight: 400 }}>{day.feedback.reason ? `: ${day.feedback.reason}` : ""}</span>
                      </p>
                      <p className="small muted mono" style={{ marginTop: 4 }}>
                        RPE {fmt(day.feedback.rpe)} · feel {fmt(day.feedback.feel)}/5
                      </p>
                      {day.matched_activity ? (
                        <p className="small" style={{ marginTop: 6 }}>
                          <span className={`sport-dot ${sportKey(day.matched_activity.sport)}`} style={{ display: "inline-block", marginRight: 6 }} />
                          Recorded {SPORT_NAME[day.matched_activity.sport] ?? day.matched_activity.type}: <span className="mono">{fmt(day.matched_activity.minutes, "min")} · load {fmt(day.matched_activity.load)}</span>
                        </p>
                      ) : (
                        <p className="small muted" style={{ marginTop: 6 }}>
                          No recorded activity matched yet. History can check again later.
                        </p>
                      )}
                    </section>
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
                <section className="panel">
                  <span className="label">Check-in saved</span>
                  {lastGenerationError(day) && lastGenerationError(day) !== error && <ErrorBox message={`Last attempt failed: ${lastGenerationError(day)}`} />}
                  <button className="primary" style={{ width: "100%", marginTop: 10 }} onClick={generate} disabled={!!offlineSince}>
                    Write today's session
                  </button>
                  <button className="link" onClick={() => setEditCheckin(true)}>
                    Edit check-in
                  </button>
                </section>
              ) : (
                !offlineSince && (
                  <CheckInForm
                    initial={day.checkin}
                    preset={{ minutes: todayPlan?.minutes ?? null, place: todayPlan?.usual ?? null, poolLength: m.last_pool_length ?? null }}
                    busy={busy}
                    onSubmit={submitCheckin}
                  />
                )
              )}
              {editCheckin && (
                <button className="link" onClick={() => setEditCheckin(false)}>
                  Cancel
                </button>
              )}
            </div>

            <div className="col">
              <section className="panel" aria-label="Fitness trend">
                <div className="spread">
                  <span className="label">Fitness · fatigue · form</span>
                  <span className="small muted">6 weeks</span>
                </div>
                <TrendChart trend={m.trend ?? []} />
              </section>
              <section className="panel" aria-label="Week load">
                <WeekLoad date={date} activities={m.activities14} />
              </section>
              <Sessions14 m={m} />
              <details className="small muted">
                <summary>How readiness is judged</summary>
                <p style={{ marginTop: 6 }}>{m.flag_rule}</p>
              </details>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
