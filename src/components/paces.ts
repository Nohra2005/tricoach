// "4:50/km" or "2:00/100m" -> seconds per unit; null if not a pace.
export function parseSecs(s: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
