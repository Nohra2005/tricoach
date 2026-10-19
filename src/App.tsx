import { useEffect, useState } from "react";
import { clearPasscode, getPasscode } from "./api";
import { Passcode } from "./screens/Passcode";
import { Today } from "./screens/Today";
import { History } from "./screens/History";
import { SettingsScreen } from "./screens/Settings";
import { load, save } from "./storage";
import { Icon } from "./components/ui";

type Tab = "today" | "history" | "settings";

export function App() {
  const [authed, setAuthed] = useState(() => getPasscode() !== null);
  const [tab, setTab] = useState<Tab>(() => load<Tab>("tab") ?? "today");

  useEffect(() => {
    const onUnauthorised = () => {
      clearPasscode();
      setAuthed(false);
    };
    window.addEventListener("tricoach:unauthorised", onUnauthorised);
    return () => window.removeEventListener("tricoach:unauthorised", onUnauthorised);
  }, []);

  function go(t: Tab) {
    setTab(t);
    save("tab", t);
    window.scrollTo(0, 0);
  }

  if (!authed) return <Passcode onDone={() => setAuthed(true)} />;

  return (
    <>
      {tab === "today" && <Today />}
      {tab === "history" && <History />}
      {tab === "settings" && (
        <SettingsScreen
          onSignOut={() => {
            clearPasscode();
            setAuthed(false);
          }}
        />
      )}
      <nav className="tabs">
        <div className="nav-brand brand">TriCoach</div>
        {(["today", "history", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => go(t)}
            aria-current={tab === t ? "page" : undefined}
          >
            <Icon name={t} />
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
    </>
  );
}
