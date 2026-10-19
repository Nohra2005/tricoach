import { useState } from "react";
import { CheckIn, LOCATIONS, type Location } from "../../shared/schemas";
import { ErrorBox, TapScale } from "../components/ui";

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
  const [motivation, setMotivation] = useState<number | null>(init?.motivation ?? null);
  const [stress, setStress] = useState<number | null>(init?.stress ?? null);
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
      motivation,
      stress,
      minutes: custom ? Number(custom) : minutes,
      locations,
      pain: hasPain ? pain.trim() || null : null,
    };
    if (hasPain && !candidate.pain) return setError("Describe the pain or illness, or switch it back to none.");
    const parsed = CheckIn.safeParse(candidate);
    if (!parsed.success) return setError("Answer every question: the four scales, time, and at least one place.");
    setError(null);
    props.onSubmit(parsed.data);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Morning check-in</h2>
      <TapScale label="Energy" value={energy} onChange={setEnergy} low="very low" high="very high" />
      <TapScale label="Muscle soreness" value={soreness} onChange={setSoreness} low="none" high="very sore" />
      <TapScale label="Motivation" value={motivation} onChange={setMotivation} low="very low" high="very high" />
      <TapScale label="Stress" value={stress} onChange={setStress} low="calm" high="very stressed" />

      <strong>Time available today</strong>
      <div className="chips" style={{ marginTop: 6 }}>
        {MINUTE_CHOICES.map((m) => (
          <button
            key={m}
            type="button"
            className={`chip ${!custom && minutes === m ? "selected" : ""}`}
            onClick={() => {
              setMinutes(m);
              setCustom("");
            }}
          >
            {m === 0 ? "None" : `${m} min`}
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

      <div style={{ marginTop: 14 }}>
        <strong>Where can you train today?</strong>
        <div className="chips" style={{ marginTop: 6 }}>
          {LOCATIONS.map((l) => (
            <button key={l} type="button" className={`chip ${locations.includes(l) ? "selected" : ""}`} onClick={() => toggle(l)}>
              {LOCATION_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <strong>Pain or illness</strong>
        <div className="chips" style={{ marginTop: 6 }}>
          <button type="button" className={`chip ${!hasPain ? "selected" : ""}`} onClick={() => setHasPain(false)}>
            None
          </button>
          <button type="button" className={`chip ${hasPain ? "selected" : ""}`} onClick={() => setHasPain(true)}>
            Something
          </button>
        </div>
        {hasPain && (
          <textarea
            style={{ marginTop: 8 }}
            placeholder="What and where? For example: sore throat, left knee pain when running"
            value={pain}
            onChange={(e) => setPain(e.target.value)}
          />
        )}
      </div>

      <ErrorBox message={error} />
      <button className="primary" style={{ marginTop: 14 }} disabled={props.busy} onClick={submit}>
        {props.busy ? "Saving..." : "Save and write today's session"}
      </button>
    </div>
  );
}
