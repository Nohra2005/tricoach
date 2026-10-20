import { useState } from "react";
import { Feedback } from "../../shared/schemas";
import { ErrorBox, Scale } from "../components/ui";

const FOLLOWED = [
  ["as_planned", "As planned"],
  ["modified", "Modified"],
  ["skipped", "Skipped"],
] as const;

export function FeedbackForm(props: { busy: boolean; onSubmit: (f: Feedback) => void }) {
  const [followed, setFollowed] = useState<Feedback["followed"] | null>(null);
  const [reason, setReason] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [feel, setFeel] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const parsed = Feedback.safeParse({
      followed,
      reason: followed === "as_planned" ? null : reason.trim() || null,
      rpe: followed === "skipped" ? null : rpe,
      feel,
      notes: notes.trim() || null,
    });
    if (!parsed.success) return setError(!followed ? "Choose whether you did the session." : parsed.error.issues[0].message);
    setError(null);
    props.onSubmit(parsed.data);
  }

  return (
    <section className="panel" aria-label="After the session">
      <span className="label">After the session</span>
      <div className="q">
        <strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Did you do it?</strong>
        <div className="seg">
          {FOLLOWED.map(([v, label]) => (
            <button key={v} type="button" className={followed === v ? "on" : ""} aria-pressed={followed === v} onClick={() => setFollowed(v)} style={{ fontFamily: "var(--sans)", fontSize: 13 }}>
              {label}
            </button>
          ))}
        </div>
        {followed && followed !== "as_planned" && (
          <label className="field">
            <span className="label">Why?</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: ran out of time, legs too heavy, lane closed" />
          </label>
        )}
      </div>
      {followed !== "skipped" && <Scale label="Effort (RPE)" value={rpe} onChange={setRpe} max={10} low="easy" high="max" />}
      <Scale label="How do you feel now?" value={feel} onChange={setFeel} low="awful" high="great" />
      <label className="field">
        <span className="label">Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorBox message={error} />
      <button className="primary" style={{ width: "100%", marginTop: 12 }} disabled={props.busy} onClick={submit}>
        {props.busy ? "Saving..." : "Save"}
      </button>
    </section>
  );
}
