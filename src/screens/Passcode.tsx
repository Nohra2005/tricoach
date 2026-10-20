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
    <main className="signin">
      <header className="band">
        <div className="label" style={{ color: "var(--accent)" }}>
          TriCoach
        </div>
        <h1 style={{ marginTop: 6 }}>Your daily session, from your data.</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Each morning TriCoach reads your watch data, asks what the watch can't measure, and writes the day's swim, bike or run.
        </p>
      </header>
      <div className="page">
        <section className="panel">
          <span className="label">Just looking?</span>
          <p style={{ marginTop: 4 }}>
            Try it with a made-up athlete and six weeks of generated data. No passcode, nothing to install, and nothing you do reaches a real account.
          </p>
          <button
            className="primary"
            style={{ width: "100%", marginTop: 12 }}
            onClick={() => {
              startDemo();
              onDone();
            }}
          >
            Try the demo
          </button>
        </section>

        <form className="panel" onSubmit={submit}>
          <span className="label">Athletes</span>
          <label className="field">
            <span className="label">Passcode</span>
            <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button disabled={busy || !value} style={{ width: "100%", marginTop: 12 }}>
            {busy ? "Checking..." : "Sign in"}
          </button>
          <ErrorBox message={error} />
        </form>
      </div>
    </main>
  );
}
