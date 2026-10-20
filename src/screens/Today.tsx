import { useCallback, useEffect, useState } from "react";
import type { CheckIn, DayRecord, Feedback, Metrics, TodayResponse } from "../../shared/schemas";
import { ApiError, api, localDate, waitForJob } from "../api";
import { ErrorBox, Icon, MetricTile, SPORT_NAME, SessionCard, fmt, hoursMinutes, sportClass } from "../components/ui";
import { load, save } from "../storage";
import { CheckInForm } from "./CheckIn";
import { FeedbackForm } from "./FeedbackForm";

interface Cached {
  savedAt: string;
  data: TodayResponse;
}

const SPORTS = ["swim", "bike", "run"] as const;

function minutesText(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)} min`;
}

function dayLabel(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// ---------- readiness ----------

function Readiness({ m }: { m: Metrics }) {
  const flag = (k: string) => m.flags.find((f) => f.metric === k);
  const last = (k: "hrv" | "resting_hr" | "sleep_hours", show: (v: number) => string) => {
    const l = m.latest?.[k];
    return l && l.date !== m.date ? `${show(l.value)} on ${dayLabel(l.date)}` : null;
  };
  const readiness = m.today.readiness ?? null;
  return (
    <>
      <h2>Readiness</h2>
      {readiness !== null && (
        <div className="tile" style={{ marginBottom: 10 }}>
          <div className="readiness-score">
            <div className="tile-label">Watch readiness</div>
            <div className="tile-value">
              {Math.round(readiness)}
              <small>/ 100</small>
            </div>
          </div>
          <div className="range" aria-hidden>
            <div className="range-band" style={{ left: 0, width: `${Math.min(100, Math.max(0, readiness))}%`, opacity: 0.9 }} />
          </div>
        </div>
      )}
      <div className="grid">
        <MetricTile
          label="HRV"
          value={m.today.hrv}
          display={fmt(m.today.hrv)}
          unit="ms"
          baseline={m.baselines.hrv}
          flag={flag("hrv")}
          lastText={last("hrv", (v) => fmt(v, "ms"))}
        />
        <MetricTile
          label="Resting HR"
          value={m.today.resting_hr}
          display={fmt(m.today.resting_hr)}
          unit="bpm"
          baseline={m.baselines.resting_hr}
          flag={flag("resting_hr")}
          lastText={last("resting_hr", (v) => fmt(v, "bpm"))}
        />
        <MetricTile
          label="Sleep"
          value={m.today.sleep_hours}
          display={hoursMinutes(m.today.sleep_hours)}
          baseline={m.baselines.sleep_hours}
          flag={flag("sleep_hours")}
          dp={1}
          lastText={last("sleep_hours", (v) => hoursMinutes(v))}
        />
        <div className="tile">
          <div className="tile-label">Form</div>
          {m.today.tsb === null ? (
            <div className="tile-value empty">No data yet</div>
          ) : (
            <div className="tile-value">{fmt(m.today.tsb, "", 1)}</div>
          )}
          <div className="small muted num">Fitness {fmt(m.today.ctl, "", 1)}</div>
          <div className="small muted num">Fatigue {fmt(m.today.atl, "", 1)}</div>
          <div className="small muted">Form = fitness minus fatigue</div>
        </div>
      </div>
      {m.flags.length > 0 && (
        <div className="card notice">
          {m.flags.map((f) => (
            <p key={f.metric} className="small">
              {f.rule}
            </p>
          ))}
        </div>
      )}
      <details className="small muted" style={{ margin: "8px 0" }}>
        <summary>How ranges work</summary>
        <p>{m.flag_rule}</p>
      </details>
    </>
  );
}

// ---------- last 7 days ----------

function LastWeek({ m }: { m: Metrics }) {
  const max = Math.max(1, ...SPORTS.map((s) => m.last7[s].minutes));
  return (
    <>
      <h2>Last 7 days</h2>
      <div className="card">
        <div className="bars">
          {SPORTS.map((s) => {
            const t = m.last7[s];
            return (
              <div className={`bar-row ${sportClass(s)}`} key={s}>
                <span className="bar-name">{SPORT_NAME[s]}</span>
                <div className="bar-track" aria-hidden>
                  <div className="bar-fill" style={{ width: `${(t.minutes / max) * 100}%` }} />
                </div>
                <span className="bar-value">{t.sessions ? minutesText(t.minutes) : "none"}</span>
              </div>
            );
          })}
        </div>
        <p className="small muted num" style={{ marginTop: 12 }}>
          {SPORTS.map((s) => `${SPORT_NAME[s]} ${m.last7[s].sessions}× load ${Math.round(m.last7[s].load)}`).join(" · ")}
          {m.last7.other.sessions ? ` · Other ${m.last7.other.sessions}×` : ""}
        </p>
        <details style={{ marginTop: 8 }}>
          <summary className="spread">
            <strong className="small">Sessions in the last 14 days ({m.activities14.length})</strong>
            <Icon name="chevron" className="chev" />
          </summary>
          {m.activities14.length === 0 ? (
            <p className="small muted">Nothing from intervals.icu yet.</p>
          ) : (
            <ul className="rowlist">
              {m.activities14.map((a) => (
                <li key={a.id} className={`small ${sportClass(a.sport)}`}>
                  <span className="dot" aria-hidden />
                  <div>
                    <strong>
                      {dayLabel(a.date)} · {a.type}
                      {a.hard ? " · hard" : ""}
                    </strong>
                    <div className="muted num">
                      {a.distance_km !== null ? `${a.distance_km} km · ` : ""}
                      load {fmt(a.load)} · HR {fmt(a.avg_hr)}
                      {a.avg_watts !== null ? ` · ${a.avg_watts} W` : ""}
                      {a.pace_per_100m ? ` · ${a.pace_per_100m}/100m` : ""}
                      {a.pace_per_km ? ` · ${a.pace_per_km}/km` : ""}
                    </div>
                  </div>
                  <span className="num" style={{ fontWeight: 800 }}>
                    {a.minutes === null ? "no data" : `${a.minutes}′`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
      {m.hidden_activities > 0 && (
        <div className="card notice small">
          {m.hidden_activities} recent activities came into intervals.icu from Strava, and intervals.icu cannot share those
          through its API. Link Garmin Connect to intervals.icu directly so they show here.
        </div>
      )}
    </>
  );
}

// ---------- your numbers ----------

function YourNumbers({ m }: { m: Metrics }) {
  const t = m.thresholds;
  const ty = m.typical;
  if (!t && !ty) return null;
  return (
    <>
      <h2>Your numbers</h2>
      {SPORTS.map((k) => {
        const s = t?.[k];
        const typ = ty?.[k];
        return (
          <details className={`card ${sportClass(k)}`} key={k}>
            <summary>
              <div className="spread">
                <span className="tag solid">{SPORT_NAME[k]}</span>
                <span className="row" style={{ gap: 6 }}>
                  <strong className="num">{s?.threshold ?? "no threshold"}</strong>
                  <Icon name="chevron" className="chev" />
                </span>
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {s?.threshold_source === "estimate"
                  ? `Estimated from ${s.threshold_basis ?? "your sessions"}. `
                  : s?.threshold_source
                    ? `Typed in ${s.threshold_source === "settings" ? "TriCoach" : "intervals.icu"} settings (no estimate yet). `
                    : ""}
                {typ && typ.sessions > 0
                  ? `Last ${ty!.days} days: ${typ.sessions} sessions${typ.median_pace ? `, typical ${typ.median_pace}` : ""}${
                      typ.median_avg_watts !== null ? `, typical ${typ.median_avg_watts} W` : ""
                    }.`
                  : `No sessions in the last ${ty?.days ?? 42} days yet.`}
              </div>
            </summary>
            {s && (s.lthr !== null || s.max_hr !== null) && (
              <p className="small num" style={{ marginTop: 10 }}>
                Threshold HR {fmt(s.lthr, "bpm")} · Max HR {fmt(s.max_hr, "bpm")}
                {s.indoor_ftp ? ` · Indoor FTP ${s.indoor_ftp} W` : ""}
              </p>
            )}
            {typ?.middle_half && <p className="small">Middle half of your sessions: {typ.middle_half}</p>}
            {s && s.work_zones.length > 0 && (
              <>
                <div className="field-label" style={{ marginTop: 10 }}>
                  {k === "bike" ? "Power zones" : "Pace zones"}
                </div>
                <ul className="small num" style={{ margin: 0, paddingLeft: 18 }}>
                  {s.work_zones.map((z) => (
                    <li key={z}>{z}</li>
                  ))}
                </ul>
              </>
            )}
            {s && s.hr_zones.length > 0 && (
              <>
                <div className="field-label" style={{ marginTop: 10 }}>
                  Heart rate zones
                </div>
                <ul className="small num" style={{ margin: 0, paddingLeft: 18 }}>
                  {s.hr_zones.map((z) => (
                    <li key={z}>{z}</li>
                  ))}
                </ul>
              </>
            )}
            {s && s.work_zones.length === 0 && s.hr_zones.length === 0 && (
              <p className="small muted">
                No zones in intervals.icu for this sport. Set them in intervals.icu Settings, or add a threshold in TriCoach
                Settings.
              </p>
            )}
          </details>
        );
      })}
      <p className="small muted">
        Estimates from your own sessions come first. Typed values are only used until there is an estimate.
      </p>
      {t?.notes.map((n) => (
        <p key={n} className="small muted">
          {n}
        </p>
      ))}
    </>
  );
}

// ---------- send to watch ----------

const WATCHABLE = new Set(["swim", "bike", "run"]);

function WatchPanel(props: { day: DayRecord; busy: boolean; offline: boolean; onSend: () => void }) {
  const { day, busy, offline, onSend } = props;
  const plan = day.plan!;
  if (!WATCHABLE.has(plan.sport)) return null;
  const w = day.watch;
  const legacy = plan.steps.some((s) => s.target_spec === null);
  const stale = !!w && (w.plan_title !== plan.title || (day.generation ? w.sent_at < day.generation.finished_at : false));
  const simulated = !!w?.simulated;
  return (
    <div className="card" style={{ margin: "14px 0 0", background: "var(--surface-2)", border: "none" }}>
      <div className="spread">
        <div>
          <div className="eyebrow muted">Garmin</div>
          {w && !stale ? (
            <p style={{ margin: "2px 0 0", fontWeight: 750 }}>
              {simulated ? "Demo: this is what would be sent" : "On your intervals.icu calendar"}
              <span className="small muted" style={{ fontWeight: 400 }}>
                {" "}
                · {new Date(w.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {w.parsed_steps !== null ? ` · ${w.parsed_steps} steps` : ""}
                {w.parsed_minutes ? ` · ${w.parsed_minutes} min` : ""}
              </span>
            </p>
          ) : (
            <p style={{ margin: "2px 0 0", fontWeight: 750 }}>
              {stale ? "You rewrote the session after sending it." : "Not on your watch yet."}
            </p>
          )}
        </div>
      </div>
      {w && !stale && w.parsed_ok === false && (
        <div className="card notice small" style={{ margin: "10px 0 0" }}>
          <strong>intervals.icu kept this as text</strong>, so your watch will show a note instead of guided steps. What was sent
          below shows the exact text intervals.icu received.
        </div>
      )}
      {legacy ? (
        <p className="small muted">This plan was written before watch support. Change the check-in and rewrite it to send it.</p>
      ) : (
        <button className="primary" style={{ marginTop: 10 }} disabled={busy || offline} onClick={onSend}>
          {busy ? "Sending..." : w && !stale ? "Send again" : stale ? "Send the new version" : "Send to watch"}
        </button>
      )}
      {w && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ textDecoration: "underline" }}>
            What was sent
          </summary>
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
            {w.text}
          </pre>
        </details>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Then sync your watch. The workout appears under Training &gt; Workouts or on today's calendar.
        {plan.sport === "swim" &&
          " Swims go to the watch as distances, repeats and rests; Garmin doesn't accept pace targets on pool steps, so check your paces here."}
      </p>
    </div>
  );
}

function lastGenerationError(day: DayRecord): string | null {
  const last = [...day.events].reverse().find((e) => e.type === "generate" || e.type === "generate_failed");
  return last?.type === "generate_failed" ? last.detail : null;
}

// ---------- screen ----------

export function Today() {
  const date = localDate();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const [editCheckin, setEditCheckin] = useState(false);
  const [sending, setSending] = useState(false);
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
  const heading = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

  return (
    <main>
      <div className="brand">TriCoach</div>
      <h1>{heading}</h1>
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
        <div className="layout-split">
          <div className="col">
            {generating !== null ? (
              <div className="card row" role="status">
                <div className="spinner" />
                <strong>Writing today's session</strong>
                <span className="muted num">{generating > 0 ? `${generating}s` : ""}</span>
              </div>
            ) : day.plan && !editCheckin ? (
              <>
                <SessionCard plan={day.plan}>
                  <WatchPanel day={day} busy={sending} offline={!!offlineSince} onSend={sendToWatch} />
                </SessionCard>
                {day.feedback ? (
                  <div className="card">
                    <div className="eyebrow muted">Your feedback</div>
                    <p style={{ fontWeight: 750, textTransform: "capitalize" }}>
                      {day.feedback.followed.replace("_", " ")}
                      <span style={{ textTransform: "none", fontWeight: 400 }}>
                        {day.feedback.reason ? `: ${day.feedback.reason}` : ""}
                      </span>
                    </p>
                    <p className="small muted num">
                      RPE {fmt(day.feedback.rpe)} · feeling {fmt(day.feedback.feel)}/5
                    </p>
                    {day.matched_activity ? (
                      <p className={`small ${sportClass(day.matched_activity.sport)}`}>
                        <span className="tag">{day.matched_activity.type}</span>{" "}
                        <span className="num">
                          {fmt(day.matched_activity.minutes, "min")} · load {fmt(day.matched_activity.load)}
                        </span>
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
                <div className="eyebrow muted">Check-in saved</div>
                {lastGenerationError(day) && <ErrorBox message={`Last attempt failed: ${lastGenerationError(day)}`} />}
                <button className="primary" style={{ marginTop: 10 }} onClick={generate} disabled={!!offlineSince}>
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
          </div>

          <div className="col">
            <Readiness m={data.metrics} />
            <LastWeek m={data.metrics} />
            <YourNumbers m={data.metrics} />
          </div>
        </div>
      )}
    </main>
  );
}
