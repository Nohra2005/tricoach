// Small shared pieces for the Analytics design.
import type { ReactNode } from "react";

export function fmt(v: number | null | undefined, unit = "", dp = 0): string {
  if (v === null || v === undefined) return "no data";
  const n = dp === 0 ? Math.round(v) : Math.round(v * 10 ** dp) / 10 ** dp;
  return `${n}${unit ? " " + unit : ""}`;
}

// 6.48 -> "6:29"
export function hm(h: number | null | undefined): string {
  if (h === null || h === undefined) return "no data";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function minutesText(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)}′`;
}

export function dayLabel(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, opts);
}

export const SPORT_NAME: Record<string, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run",
  brick: "Brick",
  strength: "Strength",
  mobility: "Mobility",
  rest: "Rest",
  other: "Other",
};

// Class for .sport-dot: swim, bike, run, or nothing (grey).
export function sportKey(sport: string): string {
  if (sport === "swim" || sport === "run") return sport;
  if (sport === "bike" || sport === "brick") return "bike";
  return "";
}

const ICONS: Record<string, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9.5 2.5h5" />
    </>
  ),
  history: <path d="M4 6h16M4 12h16M4 18h10" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
};

export function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  return message ? (
    <div className="panel error" role="alert">
      {message}
    </div>
  ) : null;
}

// 1..max as a row of buttons.
export function Scale(props: { label: string; value: number | null; onChange: (v: number) => void; max?: number; low?: string; high?: string }) {
  const { label, value, onChange, max = 5, low, high } = props;
  return (
    <div className="q" role="group" aria-label={label}>
      <div className="spread">
        <strong>{label}</strong>
        {low && high && (
          <span className="small muted">
            1 {low} · {max} {high}
          </span>
        )}
      </div>
      <div className="seg">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" className={value === n ? "on" : ""} aria-pressed={value === n} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={props.checked} aria-label={props.label} onClick={() => props.onChange(!props.checked)} />
  );
}
