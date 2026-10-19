import { useState } from "react";
import { Feedback } from "../../shared/schemas";
import { ErrorBox, TapScale } from "../components/ui";

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
    if (!parsed.success) {
      return setError(!followed ? "Choose whether you did the session." : parsed.error.issues[0].message);
    }
    setError(null);
    props.onSubmit(parsed.data);
  }

  return (
    <section className="card" aria-label="After the session">
      <div className="eyebrow muted">After the session</div>
      <h3 style={{ fontSize: "1.3rem", fontWeight: 850, margin: "4px 0 0" }}>How did it go?</h3>

      <div className="question">
        <div className="question-head">
          <strong>Did you do it?</strong>
        </div>
        <div className="chips">
          {FOLLOWED.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`chip ${followed === v ? "selected" : ""}`}
              aria-pressed={followed === v}
              onClick={() => setFollowed(v)}
            >
              {label}
            </button>
          ))}
        </div>
        {followed && followed !== "as_planned" && (
          <label className="field">
            <span>Why?</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: ran out of time, legs too heavy, pool lane closed"
            />
          </label>
        )}
      </div>

      {followed !== "skipped" && (
        <TapScale label="Effort (RPE)" value={rpe} onChange={setRpe} max={10} low="very easy" high="max" />
      )}
      <TapScale label="How do you feel now?" value={feel} onChange={setFeel} low="awful" high="great" />
      <label className="field">
        <span>Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorBox message={error} />
      <button className="primary" disabled={props.busy} onClick={submit}>
        {props.busy ? "Saving..." : "Save"}
      </button>
    </section>
  );
}
