import { useEffect, useState } from "react";
import { api, clearPasscode, getPasscode, isDemoMode, startDemo } from "./api";
import { Passcode } from "./screens/Passcode";
import { Today } from "./screens/Today";
import { History } from "./screens/History";
import { SettingsScreen } from "./screens/Settings";
import { load, save } from "./storage";
import { Icon } from "./components/ui";

type Tab = "today" | "history" | "settings";

// A link ending in ?demo (for portfolio reviewers) opens the demo straight away.
function enterDemoFromLink(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("demo")) return;
    startDemo();
    url.searchParams.delete("demo");
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
  } catch {
    /* ignore malformed URLs */
  }
}

export function App() {
  const [authed, setAuthed] = useState(() => {
    enterDemoFromLink();
    return getPasscode() !== null || isDemoMode();
  });
  const [demo, setDemo] = useState(isDemoMode);
  const [name, setName] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => load<Tab>("tab") ?? "today");

  useEffect(() => {
    const onUnauthorised = () => {
      clearPasscode();
      setAuthed(false);
    };
    window.addEventListener("tricoach:unauthorised", onUnauthorised);
    return () => window.removeEventListener("tricoach:unauthorised", onUnauthorised);
  }, []);

  useEffect(() => {
    if (!authed) return;
    setDemo(isDemoMode());
    api.me().then(
      (me) => setName(me.name),
      () => setName(null),
    );
  }, [authed]);

  function go(t: Tab) {
    setTab(t);
    save("tab", t);
    window.scrollTo(0, 0);
  }

  function signOut() {
    clearPasscode();
    setName(null);
    setAuthed(false);
  }

  if (!authed) return <Passcode onDone={() => setAuthed(true)} />;

  return (
    <>
      {demo && (
        <div className="demo-banner" role="note">
          <span>
            <strong>Demo</strong> · a made-up athlete and data. Nothing here touches a real account.
          </span>
          <button className="link" onClick={signOut}>
            Exit demo
          </button>
        </div>
      )}
      {tab === "today" && <Today />}
      {tab === "history" && <History />}
      {tab === "settings" && <SettingsScreen onSignOut={signOut} demo={demo} />}
      <nav className="tabs">
        <div className="nav-brand brand">
          TriCoach
          {name && <div className="nav-user">{name}</div>}
        </div>
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
