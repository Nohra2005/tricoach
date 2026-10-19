import { useState } from "react";
import { api, setPasscode, startDemo } from "../api";
import { ErrorBox } from "../components/ui";

export function Passcode({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await api.checkPasscode(value)) {
        setPasscode(value);
        onDone();
      } else {
        setError("That passcode is not right.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="brand">TriCoach</div>
      <h1>Your daily session, from your data.</h1>
      <p className="muted">
        Each morning TriCoach reads your watch data, asks a few quick questions, and writes the day's swim, bike or run.
      </p>

      <section className="card">
        <div className="eyebrow muted">Just looking?</div>
        <p style={{ marginTop: 4 }}>
          Try it with a made-up athlete and six weeks of generated data. No passcode, nothing to install, and nothing you do
          reaches a real account.
        </p>
        <button
          className="primary"
          onClick={() => {
            startDemo();
            onDone();
          }}
        >
          Try the demo
        </button>
      </section>

      <div className="divider">or sign in</div>

      <form onSubmit={submit}>
        <label className="field">
          <span>Passcode</span>
          <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button disabled={busy || !value} style={{ width: "100%" }}>
          {busy ? "Checking..." : "Sign in"}
        </button>
      </form>
      <ErrorBox message={error} />
    </main>
  );
}
