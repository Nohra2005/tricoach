import { useState } from "react";
import { CheckIn, LOCATIONS, type Location } from "../../shared/schemas";
import { ErrorBox, Scale } from "../components/ui";

// Asks only what the watch can't measure: energy, soreness, time, place, pain or
// illness, and pool length on pool days. Time and place are preset from the weekly
// schedule in Preferences; pool length from the last swim.
const MINUTES = [0, 30, 45, 60, 75, 90, 120];
const PLACE: Record<Location, string> = {
  pool: "Pool",
  indoor_trainer: "Trainer",
  outdoor_bike: "Outdoor bike",
  run: "Run",
  gym: "Gym",
  none: "None",
};

export function CheckInForm(props: {
  initial: CheckIn | null;
  preset: { minutes: number | null; place: Location | null; poolLength: number | null };
  busy: boolean;
  onSubmit: (c: CheckIn) => void;
}) {
  const init = props.initial;
  const pre = props.preset;
  const [energy, setEnergy] = useState<number | null>(init?.energy ?? null);
  const [soreness, setSoreness] = useState<number | null>(init?.soreness ?? null);
  const startMinutes = init?.minutes ?? pre.minutes;
  const [minutes, setMinutes] = useState<number | null>(startMinutes);
  const [custom, setCustom] = useState(startMinutes !== null && !MINUTES.includes(startMinutes) ? String(startMinutes) : "");
  const [places, setPlaces] = useState<Location[]>(init?.locations ?? (pre.place ? [pre.place] : []));
  const [pool, setPool] = useState<25 | 50>((init?.pool_length ?? (pre.poolLength === 50 ? 50 : 25)) as 25 | 50);
  const [hasPain, setHasPain] = useState(Boolean(init?.pain));
  const [pain, setPain] = useState(init?.pain ?? "");
  const [error, setError] = useState<string | null>(null);

  function toggle(p: Location) {
    if (p === "none") return setPlaces(places.includes("none") ? [] : ["none"]);
    const rest = places.filter((x) => x !== "none");
    setPlaces(rest.includes(p) ? rest.filter((x) => x !== p) : [...rest, p]);
  }

  function submit() {
    const parsed = CheckIn.safeParse({
      energy,
      soreness,
      minutes: custom ? Number(custom) : minutes,
      locations: places,
      pain: hasPain ? pain.trim() || null : null,
      pool_length: places.includes("pool") ? pool : null,
    });
    if (hasPain && !pain.trim()) return setError("Describe the pain or illness, or switch it back to None.");
    if (!parsed.success) return setError("Answer energy, soreness, time and at least one place.");
    setError(null);
    props.onSubmit(parsed.data);
  }

  return (
    <section className="panel" aria-label="Morning check-in">
      <div className="spread">
        <span className="label">Morning check-in</span>
        <span className="small muted">Watch covers HRV, sleep, stress</span>
      </div>
      <Scale label="Energy" value={energy} onChange={setEnergy} low="drained" high="great" />
      <Scale label="Muscle soreness" value={soreness} onChange={setSoreness} low="none" high="very sore" />

      <div className="q">
        <div className="spread">
          <strong>Time today</strong>
          {pre.minutes !== null && !init && <span className="small muted">from your schedule</span>}
        </div>
        <div className="seg">
          {MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className={!custom && minutes === m ? "on" : ""}
              aria-pressed={!custom && minutes === m}
              onClick={() => {
                setMinutes(m);
                setCustom("");
              }}
            >
              {m === 0 ? "0" : m}
            </button>
          ))}
        </div>
        <input
          type="number"
          inputMode="numeric"
          placeholder="Other minutes"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          aria-label="Other number of minutes"
          style={{ marginTop: 6 }}
        />
      </div>

      <div className="q">
        <div className="spread">
          <strong>Where</strong>
          <span className="small muted">all that apply</span>
        </div>
        <div className="choices">
          {LOCATIONS.map((l) => (
            <button key={l} type="button" className={places.includes(l) ? "on" : ""} aria-pressed={places.includes(l)} onClick={() => toggle(l)}>
              {PLACE[l]}
            </button>
          ))}
        </div>
      </div>

      {places.includes("pool") && (
        <div className="q">
          <div className="spread">
            <strong>Pool length</strong>
            {pre.poolLength && !init && <span className="small muted">as your last swim</span>}
          </div>
          <div className="seg">
            {([25, 50] as const).map((p) => (
              <button key={p} type="button" className={pool === p ? "on" : ""} aria-pressed={pool === p} onClick={() => setPool(p)}>
                {p} m
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="q">
        <strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Pain or illness</strong>
        <div className="seg">
          <button type="button" className={!hasPain ? "on" : ""} aria-pressed={!hasPain} onClick={() => setHasPain(false)}>
            None
          </button>
          <button type="button" className={hasPain ? "on" : ""} aria-pressed={hasPain} onClick={() => setHasPain(true)}>
            Something
          </button>
        </div>
        {hasPain && (
          <textarea
            style={{ marginTop: 8 }}
            placeholder="What and where? For example: sore throat, left knee pain when running"
            value={pain}
            onChange={(e) => setPain(e.target.value)}
            aria-label="Describe the pain or illness"
          />
        )}
      </div>

      <ErrorBox message={error} />
      <button className="primary" style={{ width: "100%", marginTop: 14 }} disabled={props.busy} onClick={submit}>
        {props.busy ? "Saving..." : "Write today's session"}
      </button>
    </section>
  );
}
