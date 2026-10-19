import { useEffect, useState } from "react";
import { Settings } from "../../shared/schemas";
import { api } from "../api";
import { ErrorBox } from "../components/ui";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const PROFILE_FIELDS: [keyof Settings["profile"], string][] = [
  ["name", "Name"],
  ["history", "Race history"],
  ["swim", "Swim"],
  ["bike", "Bike"],
  ["run", "Run"],
  ["life", "Life and schedule"],
  ["other_notes", "Other notes for the coach"],
];

export function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then(setS, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!s) {
    return (
      <main>
        <h1>Settings</h1>
        <ErrorBox message={error} />
        {!error && <div className="spinner" />}
      </main>
    );
  }

  const profile = (k: keyof Settings["profile"], v: string) => setS({ ...s, profile: { ...s.profile, [k]: v } });
  const plan = <K extends keyof Settings["plan"]>(k: K, v: Settings["plan"][K]) => setS({ ...s, plan: { ...s.plan, [k]: v } });

  async function saveAll() {
    setBusy(true);
    setError(null);
    setSaved(false);
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

  return (
    <main>
      <h1>Settings</h1>

      <h2>Goal and numbers</h2>
      <div className="card">
        <label className="field">
          <span>Next goal race</span>
          <input value={s.plan.goal_race} onChange={(e) => plan("goal_race", e.target.value)} placeholder="For example: Ironman 70.3 Lisbon" />
        </label>
        <label className="field">
          <span>Race date</span>
          <input type="date" value={s.plan.goal_race_date} onChange={(e) => plan("goal_race_date", e.target.value)} />
        </label>
        <label className="field">
          <span>FTP (watts)</span>
          <input
            type="number"
            inputMode="numeric"
            value={s.plan.ftp_watts ?? ""}
            onChange={(e) => plan("ftp_watts", e.target.value ? Number(e.target.value) : null)}
            placeholder="Leave empty to use intervals.icu"
          />
        </label>
        <label className="field">
          <span>Run threshold pace (per km)</span>
          <input value={s.plan.threshold_run_pace} onChange={(e) => plan("threshold_run_pace", e.target.value)} placeholder="Empty = intervals.icu. For example: 5:10/km" />
        </label>
        <label className="field">
          <span>Swim CSS (per 100 m)</span>
          <input value={s.plan.swim_css} onChange={(e) => plan("swim_css", e.target.value)} placeholder="Empty = intervals.icu. For example: 2:05/100m" />
        </label>
        <label className="field">
          <span>Current focus</span>
          <textarea value={s.plan.focus} onChange={(e) => plan("focus", e.target.value)} placeholder="For example: base building, more swim technique" />
        </label>
        <label className="field">
          <span>Maximum hard sessions per 7 days</span>
          <input
            type="number"
            min={0}
            max={4}
            value={s.plan.max_hard_per_week}
            onChange={(e) => plan("max_hard_per_week", Number(e.target.value))}
          />
        </label>
        <div className="field">
          <span className="small muted">Usual swim days</span>
          <div className="chips" style={{ marginTop: 6 }}>
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                className={`chip ${s.plan.usual_swim_days.includes(d) ? "selected" : ""}`}
                onClick={() =>
                  plan(
                    "usual_swim_days",
                    s.plan.usual_swim_days.includes(d) ? s.plan.usual_swim_days.filter((x) => x !== d) : [...s.plan.usual_swim_days, d],
                  )
                }
              >
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h2>Fixed sessions</h2>
      {s.plan.set_sessions.map((ss, i) => {
        const update = (patch: Partial<typeof ss>) =>
          plan(
            "set_sessions",
            s.plan.set_sessions.map((x, j) => (j === i ? { ...x, ...patch } : x)),
          );
        return (
          <div className="card" key={i}>
            <div className="row">
              <select value={ss.weekday} onChange={(e) => update({ weekday: e.target.value as typeof ss.weekday })} style={{ flex: 2 }}>
                {WEEKDAYS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              <input value={ss.time} onChange={(e) => update({ time: e.target.value })} style={{ flex: 1 }} aria-label="Time" />
              <select value={ss.sport} onChange={(e) => update({ sport: e.target.value as typeof ss.sport })} style={{ flex: 1 }}>
                {["swim", "bike", "run", "strength"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            <input style={{ marginTop: 8 }} value={ss.description} onChange={(e) => update({ description: e.target.value })} aria-label="Description" />
            <button className="link" onClick={() => plan("set_sessions", s.plan.set_sessions.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        );
      })}
      <button
        className="link"
        onClick={() =>
          plan("set_sessions", [...s.plan.set_sessions, { weekday: "Saturday", time: "08:00", sport: "bike", description: "" }])
        }
      >
        Add a fixed session
      </button>

      <h2>Athlete profile</h2>
      <div className="card">
        {PROFILE_FIELDS.map(([k, label]) => (
          <label className="field" key={k}>
            <span>{label}</span>
            {k === "name" ? (
              <input value={s.profile[k]} onChange={(e) => profile(k, e.target.value)} />
            ) : (
              <textarea value={s.profile[k]} onChange={(e) => profile(k, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      <ErrorBox message={error} />
      {saved && <p className="small" style={{ color: "var(--ok)" }}>Saved. The next session you generate uses these settings.</p>}
      <button className="primary" disabled={busy} onClick={saveAll}>
        {busy ? "Saving..." : "Save settings"}
      </button>

      <h2>Connection</h2>
      <div className="row">
        <button
          onClick={async () => {
            setHealth("Checking...");
            try {
              setHealth(JSON.stringify(await api.health(), null, 2));
            } catch (e) {
              setHealth(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Check connections
        </button>
        <button onClick={onSignOut}>Forget passcode</button>
      </div>
      {health && (
        <pre className="card small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {health}
        </pre>
      )}
    </main>
  );
}
