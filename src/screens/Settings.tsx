import { useEffect, useState } from "react";
import { LOCATIONS, PHASES, RACE_DISTANCES, Settings, WEEKDAYS, type Location, type Metrics, type Race, type Weekday } from "../../shared/schemas";
import { api, localDate } from "../api";
import { ErrorBox, Icon, Switch, fmt, hm } from "../components/ui";

type Tab = "data" | "prefs" | "connections" | "export";
const PLACE: Record<Location, string> = { pool: "Pool", indoor_trainer: "Trainer", outdoor_bike: "Outdoor bike", run: "Run", gym: "Gym", none: "Rest" };
const DIST: Record<(typeof RACE_DISTANCES)[number], string> = { sprint: "Sprint", olympic: "Olympic", "70.3": "70.3", full: "Full", run: "Run race", other: "Other" };
type SportT = NonNullable<Metrics["thresholds"]>["bike"];

export function SettingsScreen({ onSignOut, demo = false }: { onSignOut: () => void; demo?: boolean }) {
  const [tab, setTab] = useState<Tab>("data");
  const tabs: [Tab, string][] = [
    ["data", "Your data"],
    ["prefs", "Preferences"],
    ["connections", "Connections"],
    ["export", "Export"],
  ];
  return (
    <main>
      <header className="band" style={{ paddingBottom: 0 }}>
        <h1>Settings</h1>
        <nav className="tabs-top" aria-label="Settings sections">
          {tabs.map(([t, label]) => (
            <button key={t} className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="page">
        {tab === "data" && <YourData />}
        {tab === "prefs" && <Preferences />}
        {tab === "connections" && <Connections />}
        {tab === "export" && <Export onSignOut={onSignOut} demo={demo} />}
      </div>
    </main>
  );
}

// ---------- Your data (read-only) ----------

function ZoneTable({ zones }: { zones: string[] }) {
  return (
    <table className="t" style={{ marginTop: 6 }}>
      <tbody>
        {zones.map((z) => {
          const i = z.indexOf(": ");
          return (
            <tr key={z}>
              <td>{i > 0 ? z.slice(0, i) : z}</td>
              <td className="num mono">{i > 0 ? z.slice(i + 2) : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Threshold({ sport, label, t }: { sport: string; label: string; t: SportT }) {
  const measured = t.threshold !== null && t.threshold_source === "estimate";
  return (
    <section className="panel" aria-label={label}>
      <div className="spread">
        <span className="row" style={{ gap: 8 }}>
          <span className={`sport-dot ${sport}`} />
          <strong>{label}</strong>
        </span>
        <span className={`chip ${measured ? "ok" : "warn"}`}>{measured ? "Measured" : "Not enough data"}</span>
      </div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 8, color: measured ? undefined : "var(--faint)" }}>
        {measured ? t.threshold : "—"}
      </div>
      <p className={`small ${measured ? "muted" : ""}`} style={{ marginTop: 4 }}>
        {measured ? t.threshold_basis : t.missing}
      </p>
      {t.ignored && (
        <p className="small muted" style={{ marginTop: 6 }}>
          {t.ignored}
        </p>
      )}
      {measured && t.work_zones.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ color: "var(--accent)" }}>
            {sport === "bike" ? "Power zones" : "Pace zones"}
          </summary>
          <ZoneTable zones={t.work_zones} />
        </details>
      )}
    </section>
  );
}

const paceText = (secs: number | null) => (secs === null ? "—" : `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`);

function RunPaceAtHrPanel({ r }: { r: NonNullable<Metrics["run_pace_at_hr"]> | null }) {
  return (
    <section className="panel" aria-label="Run pace at each heart rate">
      <div className="spread">
        <span className="row" style={{ gap: 8 }}>
          <span className="sport-dot run" />
          <strong>Run · your pace at each heart rate</strong>
        </span>
        <span className={`chip ${r ? "ok" : "warn"}`}>{r ? "Measured" : "Not enough data"}</span>
      </div>
      {r ? (
        <>
          <table className="t" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>ZONE</th>
                <th className="num">HEART RATE</th>
                <th className="num">YOUR PACE /KM</th>
              </tr>
            </thead>
            <tbody>
              {r.zones.map((z) => (
                <tr key={z.zone}>
                  <td>
                    Z{z.zone} {z.name}
                  </td>
                  <td className="num mono">
                    {z.hr_low}–{z.hr_high}
                  </td>
                  <td className="num mono">
                    {z.pace_slow === null && z.pace_fast === null
                      ? "no runs yet"
                      : z.pace_slow === null
                        ? `slower than ${paceText(z.pace_fast)}`
                        : z.pace_fast === null
                          ? `faster than ${paceText(z.pace_slow)}`
                          : `${paceText(z.pace_slow)} to ${paceText(z.pace_fast)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 6 }}>
            From the {r.basis}. Easy and aerobic run paces come from this, not from the threshold. Hills and heat make it slower.
          </p>
        </>
      ) : (
        <p className="small" style={{ marginTop: 4 }}>
          Needs at least 5 runs of 15 minutes or more with heart rate in the last 6 weeks. Until then runs are coached by heart rate.
        </p>
      )}
    </section>
  );
}

function YourData() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.today(localDate()).then(
      (r) => setM(r.metrics),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  if (error) return <ErrorBox message={error} />;
  if (!m) return <div className="spinner" />;
  const t = m.thresholds;
  const b = m.baselines;
  const range = (x: typeof b.hrv, f: (v: number) => string = (v) => fmt(v)) =>
    x.mean28 !== null && x.sd28 !== null && x.n28 >= 10 ? `${f(x.mean28 - x.sd28)}–${f(x.mean28 + x.sd28)}` : `${x.n28}/10 days`;
  const ty = m.typical;
  const heart = t?.heart;
  return (
    <div className="split">
      <div className="col">
        <div className="panel info row small" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <Icon name="shield" />
          <span>
            Everything here is measured from your sessions and watch, and can't be typed over. Where there isn't enough data yet, TriCoach says so and coaches by
            heart rate or effort instead.
          </span>
        </div>
        {t ? (
          <>
            <Threshold sport="bike" label="Bike · FTP" t={t.bike} />
            <Threshold sport="run" label="Run · threshold pace" t={t.run} />
            <RunPaceAtHrPanel r={m.run_pace_at_hr ?? null} />
            <Threshold sport="swim" label="Swim · CSS" t={t.swim} />
          </>
        ) : (
          <p className="small muted">Thresholds appear after the first sync with intervals.icu.</p>
        )}
      </div>
      <div className="col">
        <section className="panel" aria-label="Heart rate zones">
          <div className="spread">
            <strong>Heart rate zones</strong>
            <span className={`chip ${heart?.max_hr ? "ok" : "warn"}`}>{heart?.max_hr ? "Measured" : "Not enough data"}</span>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            {heart?.max_hr ? `Max HR ${heart.max_hr} bpm, ${heart.basis}.` : "Needs a few sessions recorded with heart rate."}
          </p>
          {heart && heart.zones.length > 0 && <ZoneTable zones={heart.zones} />}
        </section>
        <section className="panel" aria-label="Baselines">
          <span className="label">Your normal range · 28 days</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
            <div>
              <div className="small muted">HRV (ms)</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {range(b.hrv)}
              </div>
            </div>
            <div>
              <div className="small muted">Resting HR</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {range(b.resting_hr)}
              </div>
            </div>
            <div>
              <div className="small muted">Sleep</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {range(b.sleep_hours, hm)}
              </div>
            </div>
          </div>
          {ty && (
            <table className="t" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>LAST {ty.days} DAYS</th>
                  <th className="num">SESSIONS</th>
                  <th className="num">TYPICAL</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Swim</td>
                  <td className="num mono">{ty.swim.sessions}</td>
                  <td className="num mono">{ty.swim.median_pace ?? "—"}</td>
                </tr>
                <tr>
                  <td>Bike</td>
                  <td className="num mono">{ty.bike.sessions}</td>
                  <td className="num mono">
                    {ty.bike.median_avg_watts !== null ? `${ty.bike.median_avg_watts} W` : ty.bike.median_avg_hr !== null ? `${ty.bike.median_avg_hr} bpm` : "—"}
                  </td>
                </tr>
                <tr>
                  <td>Run</td>
                  <td className="num mono">{ty.run.sessions}</td>
                  <td className="num mono">{ty.run.median_pace ?? "—"}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- Preferences ----------

function endOfWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return localDate(d);
}

function Preferences() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.settings().then(setS, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (!s) return error ? <ErrorBox message={error} /> : <div className="spinner" />;

  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setS({ ...s, ...patch });
  };
  const setDay = (d: Weekday, patch: Partial<Settings["schedule"][Weekday]>) => set({ schedule: { ...s.schedule, [d]: { ...s.schedule[d], ...patch } } });
  const setRace = (i: number, patch: Partial<Race>) => set({ races: s.races.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  type Fixed = Settings["fixed_sessions"][number];
  const setFixed = (i: number, patch: Partial<Fixed>) => set({ fixed_sessions: s.fixed_sessions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const total = WEEKDAYS.reduce((a, d) => a + s.schedule[d].minutes, 0);
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const week = s.this_week && s.this_week.until >= localDate() ? s.this_week : null;

  async function saveAll() {
    setBusy(true);
    setError(null);
    try {
      const parsed = Settings.safeParse(s);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      setS(await api.saveSettings(parsed.data));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const kvRow = { alignItems: "center" } as const;

  return (
    <div className="split">
      <div className="col">
        <section className="panel" aria-label="Races">
          <span className="label">Races</span>
          {s.races.length === 0 && <p className="small muted">No races yet. The coach plans general fitness.</p>}
          {s.races.map((r, i) => (
            <div key={i} style={{ borderTop: i ? "1px solid var(--line-soft)" : undefined, paddingTop: i ? 10 : 0, marginTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 8 }}>
                <select value={r.priority} onChange={(e) => setRace(i, { priority: e.target.value as Race["priority"] })} aria-label="Priority">
                  <option>A</option>
                  <option>B</option>
                  <option>C</option>
                </select>
                <input value={r.name} placeholder="Race name" onChange={(e) => setRace(i, { name: e.target.value })} aria-label="Race name" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <input type="date" value={r.date} onChange={(e) => setRace(i, { date: e.target.value })} aria-label="Race date" />
                <select value={r.distance} onChange={(e) => setRace(i, { distance: e.target.value as Race["distance"] })} aria-label="Distance">
                  {RACE_DISTANCES.map((d) => (
                    <option key={d} value={d}>
                      {DIST[d]}
                    </option>
                  ))}
                </select>
              </div>
              <button className="link" onClick={() => set({ races: s.races.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <button
            style={{ width: "100%", marginTop: 8, borderStyle: "dashed" }}
            disabled={s.races.length >= 6}
            onClick={() => set({ races: [...s.races, { priority: s.races.length ? "B" : "A", name: "", date: "", distance: "olympic" }] })}
          >
            Add race
          </button>
        </section>

        <section className="panel" aria-label="Weekly schedule">
          <div className="spread">
            <span className="label">Weekly schedule</span>
            <span className="mono small muted">
              {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")} / week
            </span>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>DAY</th>
                <th>MIN</th>
                <th>USUALLY</th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((d) => (
                <tr key={d}>
                  <td style={{ verticalAlign: "middle" }}>{d.slice(0, 3)}</td>
                  <td style={{ width: 84 }}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={600}
                      value={s.schedule[d].minutes}
                      onChange={(e) => setDay(d, { minutes: Math.min(600, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                      aria-label={`${d} minutes`}
                      style={{ padding: "6px 8px" }}
                    />
                  </td>
                  <td>
                    <select
                      value={s.schedule[d].usual ?? ""}
                      onChange={(e) => setDay(d, { usual: (e.target.value || null) as Location | null })}
                      aria-label={`${d} usual place`}
                      style={{ padding: "6px 8px" }}
                    >
                      <option value="">Any</option>
                      {LOCATIONS.map((l) => (
                        <option key={l} value={l}>
                          {PLACE[l]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 6 }}>
            Presets the morning check-in, which can still change any day.
          </p>

          <div className="label" style={{ marginTop: 14 }}>
            Fixed sessions
          </div>
          {s.fixed_sessions.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 76px 1fr", gap: 6, marginTop: 8 }}>
              <select value={f.weekday} onChange={(e) => setFixed(i, { weekday: e.target.value as Weekday })} aria-label="Day">
                {WEEKDAYS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              <input value={f.time} maxLength={10} onChange={(e) => setFixed(i, { time: e.target.value })} aria-label="Time" />
              <select value={f.sport} onChange={(e) => setFixed(i, { sport: e.target.value as Fixed["sport"] })} aria-label="Sport">
                {(["swim", "bike", "run", "strength"] as const).map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input
                style={{ gridColumn: "1 / -1" }}
                value={f.description}
                maxLength={120}
                placeholder="What it is, e.g. club group run"
                onChange={(e) => setFixed(i, { description: e.target.value })}
                aria-label="Description"
              />
              <button className="link" style={{ justifySelf: "start" }} onClick={() => set({ fixed_sessions: s.fixed_sessions.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          {s.fixed_sessions.length < 7 && (
            <button className="link" onClick={() => set({ fixed_sessions: [...s.fixed_sessions, { weekday: "Saturday", time: "08:00", sport: "bike", description: "" }] })}>
              Add a fixed session
            </button>
          )}

          <div className="label" style={{ marginTop: 14 }}>
            This week only
          </div>
          {week ? (
            <div style={{ marginTop: 6 }}>
              <p className="small">Until {week.until}. The normal week comes back after.</p>
              <div className="choices" style={{ marginTop: 6 }}>
                {(["swim", "bike", "run"] as const).map((sp) => (
                  <button
                    key={sp}
                    className={week.no_sports.includes(sp) ? "on" : ""}
                    aria-pressed={week.no_sports.includes(sp)}
                    onClick={() => set({ this_week: { ...week, no_sports: toggleIn(week.no_sports, sp) } })}
                  >
                    No {sp}
                  </button>
                ))}
              </div>
              <input
                style={{ marginTop: 6 }}
                value={week.note}
                maxLength={200}
                placeholder="Note, e.g. travelling, hotel gym only"
                onChange={(e) => set({ this_week: { ...week, note: e.target.value } })}
                aria-label="This week note"
              />
              <button className="link" onClick={() => set({ this_week: null })}>
                End the change
              </button>
            </div>
          ) : (
            <button style={{ width: "100%", marginTop: 6 }} onClick={() => set({ this_week: { until: endOfWeek(), note: "", no_sports: [] } })}>
              Change this week only (travel, no bike…)
            </button>
          )}
        </section>

        <section className="panel" aria-label="Week structure">
          <span className="label">Week structure · optional</span>
          <div className="kv" style={kvRow}>
            <span>Long ride day</span>
            <select style={{ width: 150 }} value={s.long_ride_day ?? ""} onChange={(e) => set({ long_ride_day: (e.target.value || null) as Weekday | null })} aria-label="Long ride day">
              <option value="">No preference</option>
              {WEEKDAYS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="kv" style={kvRow}>
            <span>Long run day</span>
            <select style={{ width: 150 }} value={s.long_run_day ?? ""} onChange={(e) => set({ long_run_day: (e.target.value || null) as Weekday | null })} aria-label="Long run day">
              <option value="">No preference</option>
              {WEEKDAYS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="kv" style={kvRow}>
            <span>
              Max sessions / week
              <div className="small muted">swim · bike · run</div>
            </span>
            <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              {(["swim", "bike", "run"] as const).map((sp) => (
                <input
                  key={sp}
                  type="number"
                  min={0}
                  max={14}
                  inputMode="numeric"
                  placeholder="—"
                  value={s.max_sessions[sp] ?? ""}
                  onChange={(e) =>
                    set({ max_sessions: { ...s.max_sessions, [sp]: e.target.value === "" ? null : Math.min(14, Math.max(0, Math.round(Number(e.target.value)))) } })
                  }
                  aria-label={`Max ${sp} sessions per week`}
                  title={sp}
                  style={{ width: 52, padding: 6, textAlign: "center", borderColor: `var(--${sp})` }}
                />
              ))}
            </span>
          </div>
          <div className="kv" style={kvRow}>
            <span>Strength sessions</span>
            <Switch checked={s.strength} onChange={(v) => set({ strength: v })} label="Strength sessions" />
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Each limit gives the coach less room, so leave empty what you don't mind.
          </p>
        </section>
      </div>

      <div className="col">
        <section className="panel" aria-label="Coaching">
          <span className="label">Coaching</span>
          <div className="kv" style={kvRow}>
            <span>Hard sessions per week</span>
            <select style={{ width: 80 }} value={s.max_hard_per_week} onChange={(e) => set({ max_hard_per_week: Number(e.target.value) })} aria-label="Hard sessions per week">
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="kv" style={kvRow}>
            <span>Phase</span>
            <select style={{ width: 150 }} value={s.phase} onChange={(e) => set({ phase: e.target.value as Settings["phase"] })} aria-label="Phase">
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1).replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="kv" style={kvRow}>
            <span>
              Run targets
              <div className="small muted">paces come from your own runs</div>
            </span>
            <div className="seg" style={{ width: 180 }}>
              {(
                [
                  ["hr", "Heart rate"],
                  ["pace", "Pace"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" className={s.run_targets === v ? "on" : ""} aria-pressed={s.run_targets === v} onClick={() => set({ run_targets: v })} style={{ fontFamily: "var(--sans)", fontSize: 13 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="kv" style={kvRow}>
            <span>
              Keep one-sided breathing
              <div className="small muted">in every swim set</div>
            </span>
            <Switch checked={s.one_sided_breathing} onChange={(v) => set({ one_sided_breathing: v })} label="Keep one-sided breathing" />
          </div>
          <div className="kv" style={kvRow}>
            <span>Returning from injury</span>
            <Switch checked={s.returning_from_injury} onChange={(v) => set({ returning_from_injury: v })} label="Returning from injury" />
          </div>
        </section>

        <section className="panel" aria-label="Experience and equipment">
          <span className="label">Races finished</span>
          <div className="choices" style={{ marginTop: 8 }}>
            {(["sprint", "olympic", "70.3", "full"] as const).map((d) => (
              <button key={d} className={s.finished.includes(d) ? "on" : ""} aria-pressed={s.finished.includes(d)} onClick={() => set({ finished: toggleIn(s.finished, d) })}>
                {DIST[d]}
              </button>
            ))}
          </div>
          <div className="label" style={{ marginTop: 14 }}>
            Equipment
          </div>
          <div className="choices" style={{ marginTop: 8 }}>
            {(
              [
                ["smart_trainer", "Smart trainer"],
                ["outdoor_power_meter", "Outdoor power meter"],
                ["chest_hr_strap", "Chest HR strap"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={s.equipment[k] ? "on" : ""} aria-pressed={s.equipment[k]} onClick={() => set({ equipment: { ...s.equipment, [k]: !s.equipment[k] } })}>
                {label}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Pool length isn't a setting: it's read from each swim and asked in the check-in on pool days.
          </p>
        </section>

        <section className="panel" aria-label="Name and note">
          <label className="field" style={{ marginTop: 0 }}>
            <span className="label">Name</span>
            <input value={s.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Note for the coach · optional</span>
            <textarea
              maxLength={300}
              value={s.coach_note}
              placeholder="Anything else, in one or two lines. Paces and thresholds come from your data."
              onChange={(e) => set({ coach_note: e.target.value })}
            />
          </label>
          <p className="small muted mono" style={{ textAlign: "right" }}>
            {s.coach_note.length}/300
          </p>
        </section>

        <ErrorBox message={error} />
        {saved && (
          <p className="small" style={{ color: "var(--ok)" }}>
            Saved. The next session uses these preferences.
          </p>
        )}
        <button className="primary" disabled={busy} onClick={saveAll}>
          {busy ? "Saving..." : "Save preferences"}
        </button>
      </div>
    </div>
  );
}

// ---------- Connections ----------

interface Check<T> {
  ok: boolean;
  result?: T;
  error?: string;
}
interface Health {
  account?: { name: string; kind: string };
  intervals?: {
    athlete?: Check<{ name?: string | null }>;
    wellness?: Check<{ last_date_with_data?: Record<string, string | null> }>;
    activities?: Check<{ activities_returned?: number; hidden_strava_stubs?: number }>;
  };
  ai?: Check<{ provider?: string; model?: string }>;
}

function Connections() {
  const [h, setH] = useState<Health | null>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try {
      const r = (await api.health()) as Health;
      setH(r);
      setRaw(JSON.stringify(r, null, 2));
    } catch (e) {
      setRaw(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  const dot = (ok: boolean | undefined) => (
    <span aria-label={ok ? "working" : "not working"} style={{ color: ok ? "var(--ok)" : "var(--bad)", fontWeight: 700, marginRight: 6 }}>
      ●
    </span>
  );
  const i = h?.intervals;
  const last = i?.wellness?.result?.last_date_with_data;
  const lastDate = last ? Object.values(last).filter(Boolean).sort().pop() : undefined;
  return (
    <div className="split">
      <div className="col">
        <section className="panel" aria-label="Connections">
          <span className="label">Connections</span>
          {!h && busy && <div className="spinner" style={{ marginTop: 10 }} />}
          {h && (
            <>
              <div className="kv">
                <span>{dot(i?.athlete?.ok)}intervals.icu</span>
                <span className="muted">
                  {i?.athlete?.ok ? (h.account?.kind === "demo" ? "demo data" : (i.athlete.result?.name ?? "connected")) : (i?.athlete?.error ?? "not connected")}
                </span>
              </div>
              <div className="kv">
                <span>{dot(i?.wellness?.ok)}Watch data (HRV, sleep, resting HR)</span>
                <span className="muted mono">{lastDate ?? "—"}</span>
              </div>
              <div className="kv">
                <span>{dot(i?.activities?.ok)}Sessions, last 14 days</span>
                <span className="muted mono">{i?.activities?.result?.activities_returned ?? "—"}</span>
              </div>
              <div className="kv">
                <span>{dot(h.ai?.ok)}AI coach</span>
                <span className="muted mono">{h.ai?.ok ? h.ai.result?.model : "error"}</span>
              </div>
              {(i?.activities?.result?.hidden_strava_stubs ?? 0) > 0 && (
                <p className="small" style={{ color: "var(--warn)", marginTop: 8 }}>
                  Some sessions came from Strava and can't be read. Link Garmin to intervals.icu directly.
                </p>
              )}
            </>
          )}
          <button style={{ width: "100%", marginTop: 10 }} disabled={busy} onClick={check}>
            {busy ? "Checking..." : "Check again"}
          </button>
        </section>
        <section className="panel small" aria-label="Garmin">
          <span className="label">Garmin</span>
          <p style={{ marginTop: 4 }}>
            Watch data reaches TriCoach through intervals.icu. To get sessions on your watch, turn on "Upload planned workouts" in intervals.icu's Garmin settings, then
            use Send to Garmin on Today and sync the watch.
          </p>
        </section>
      </div>
      <div className="col">
        {raw && (
          <details className="panel">
            <summary className="small">Technical details</summary>
            <pre>{raw}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

// ---------- Import ----------

// Brings in a TriCoach JSON export (for example from the old site). Sent in batches of 10
// days so each request stays small.
function ImportPanel() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setStatus("Reading the file...");
    try {
      const data = JSON.parse(await file.text()) as { days?: unknown[]; settings?: unknown };
      if (!Array.isArray(data.days)) throw new Error("This is not a TriCoach JSON export (no days in it).");
      let imported = 0;
      const skipped: string[] = [];
      for (let i = 0; i < data.days.length; i += 10) {
        setStatus(`Importing ${Math.min(i + 10, data.days.length)} of ${data.days.length} days...`);
        const r = await api.importData(data.days.slice(i, i + 10), i === 0 ? data.settings : undefined);
        imported += r.imported;
        skipped.push(...r.skipped);
      }
      setStatus(`Imported ${imported} days${data.settings !== undefined ? " and your preferences" : ""}.${skipped.length ? ` Skipped ${skipped.length} that could not be read: ${skipped.join(", ")}.` : ""}`);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Import">
      <span className="label">Import</span>
      <p className="small muted" style={{ marginTop: 4 }}>
        Bring in a TriCoach JSON export, for example from the old site. Days already here are replaced by the imported ones.
      </p>
      <label className="field">
        <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} aria-label="TriCoach JSON export file" />
      </label>
      {status && (
        <p className="small" style={{ marginTop: 8 }}>
          {status}
        </p>
      )}
      <ErrorBox message={error} />
    </section>
  );
}

// ---------- Export ----------

function Export({ onSignOut, demo }: { onSignOut: () => void; demo: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleted, setDeleted] = useState<number | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="split">
      <div className="col">
        <section className="panel" aria-label="Research data">
          <span className="label">Research data</span>
          <p className="small muted" style={{ marginTop: 4 }}>
            Every day's watch metrics, check-in, recommended session, what you did and your feedback.
          </p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button disabled={busy} onClick={() => run(() => api.download("csv"))}>
              Export CSV
            </button>
            <button disabled={busy} onClick={() => run(() => api.download("json"))}>
              Export JSON
            </button>
          </div>
        </section>
        <ImportPanel />
        <ErrorBox message={error} />
        <button onClick={onSignOut}>{demo ? "Exit demo" : "Sign out"}</button>
      </div>
      <div className="col">
        <section className="panel" aria-label="Delete my data">
          <span className="label">Delete my data</span>
          <p className="small muted" style={{ marginTop: 4 }}>
            Deletes your check-ins, sessions, feedback and preferences in TriCoach. Nothing in intervals.icu or Garmin is touched. Type DELETE to confirm.
          </p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
            <button
              className="danger"
              disabled={busy || confirm !== "DELETE"}
              onClick={() =>
                run(async () => {
                  setDeleted((await api.deleteData()).deleted);
                  setConfirm("");
                })
              }
            >
              Delete
            </button>
          </div>
          {deleted !== null && (
            <p className="small" style={{ marginTop: 8 }}>
              Deleted {deleted} records.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
