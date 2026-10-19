import { useState } from "react";
import { CheckIn, LOCATIONS, type Location } from "../../shared/schemas";
import { ErrorBox, TapScale } from "../components/ui";

// The check-in asks only what the watch cannot measure: energy, soreness, time,
// place, and pain or illness. Garmin covers stress and readiness.
const MINUTE_CHOICES = [0, 30, 45, 60, 75, 90, 120];
const LOCATION_LABEL: Record<Location, string> = {
  pool: "Pool",
  indoor_trainer: "Indoor trainer",
  outdoor_bike: "Outdoor bike",
  run: "Run",
  gym: "Gym",
  none: "None",
};

export function CheckInForm(props: { initial: CheckIn | null; busy: boolean; onSubmit: (c: CheckIn) => void }) {
  const init = props.initial;
  const [energy, setEnergy] = useState<number | null>(init?.energy ?? null);
  const [soreness, setSoreness] = useState<number | null>(init?.soreness ?? null);
  const [minutes, setMinutes] = useState<number | null>(init?.minutes ?? null);
  const [custom, setCustom] = useState(init && !MINUTE_CHOICES.includes(init.minutes) ? String(init.minutes) : "");
  const [locations, setLocations] = useState<Location[]>(init?.locations ?? []);
  const [hasPain, setHasPain] = useState(Boolean(init?.pain));
  const [pain, setPain] = useState(init?.pain ?? "");
  const [error, setError] = useState<string | null>(null);

  function toggle(loc: Location) {
    if (loc === "none") return setLocations(locations.includes("none") ? [] : ["none"]);
    const rest = locations.filter((l) => l !== "none");
    setLocations(rest.includes(loc) ? rest.filter((l) => l !== loc) : [...rest, loc]);
  }

  function submit() {
    const candidate = {
      energy,
      soreness,
      minutes: custom ? Number(custom) : minutes,
      locations,
      pain: hasPain ? pain.trim() || null : null,
    };
    if (hasPain && !candidate.pain) return setError("Describe the pain or illness, or switch it back to None.");
    const parsed = CheckIn.safeParse(candidate);
    if (!parsed.success) return setError("Answer each question: energy, soreness, time, and at least one place.");
    setError(null);
    props.onSubmit(parsed.data);
  }

  return (
    <section className="card" aria-label="Morning check-in">
      <div className="eyebrow muted">Morning check-in</div>
      <h3 style={{ fontSize: "1.3rem", fontWeight: 850, margin: "4px 0 0" }}>How are you today?</h3>
      <p className="small muted">Your watch covers HRV, sleep, stress and readiness. These are the things it can't measure.</p>

      <TapScale label="Energy" value={energy} onChange={setEnergy} low="drained" high="great" />
      <TapScale label="Muscle soreness" value={soreness} onChange={setSoreness} low="none" high="very sore" />

      <div className="question">
        <div className="question-head">
          <strong>Time to train today</strong>
        </div>
        <div className="chips">
          {MINUTE_CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${!custom && minutes === m ? "selected" : ""}`}
              aria-pressed={!custom && minutes === m}
              onClick={() => {
                setMinutes(m);
                setCustom("");
              }}
            >
              {m === 0 ? "None" : `${m}′`}
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            placeholder="Other"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            style={{ width: 96 }}
            aria-label="Other number of minutes"
          />
        </div>
      </div>

      <div className="question">
        <div className="question-head">
          <strong>Where can you train?</strong>
          <span className="small muted">pick all that apply</span>
        </div>
        <div className="chips">
          {LOCATIONS.map((l) => (
            <button
              key={l}
              type="button"
              className={`chip ${locations.includes(l) ? "selected" : ""}`}
              aria-pressed={locations.includes(l)}
              onClick={() => toggle(l)}
            >
              {LOCATION_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="question">
        <div className="question-head">
          <strong>Pain or illness</strong>
        </div>
        <div className="chips">
          <button type="button" className={`chip ${!hasPain ? "selected" : ""}`} aria-pressed={!hasPain} onClick={() => setHasPain(false)}>
            None
          </button>
          <button type="button" className={`chip ${hasPain ? "selected" : ""}`} aria-pressed={hasPain} onClick={() => setHasPain(true)}>
            Something
          </button>
        </div>
        {hasPain && (
          <textarea
            style={{ marginTop: 10 }}
            placeholder="What and where? For example: sore throat, left knee pain when running"
            value={pain}
            onChange={(e) => setPain(e.target.value)}
            aria-label="Describe the pain or illness"
          />
        )}
      </div>

      <ErrorBox message={error} />
      <button className="primary" disabled={props.busy} onClick={submit}>
        {props.busy ? "Saving..." : "Write today's session"}
      </button>
    </section>
  );
}
