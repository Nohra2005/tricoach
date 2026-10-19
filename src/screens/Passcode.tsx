import { useState } from "react";
import { api, setPasscode } from "../api";
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
      <h1>TriCoach</h1>
      <p className="muted">Enter your passcode. This device will remember it.</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Passcode</span>
          <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        <button className="primary" disabled={busy || !value}>
          {busy ? "Checking..." : "Continue"}
        </button>
      </form>
      <ErrorBox message={error} />
    </main>
  );
}
