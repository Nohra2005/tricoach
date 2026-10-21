// POST /api/match : re-runs activity matching for the last 30 days' plans that have
// no matched activity yet (Garmin can take a while to sync).
import type { RouteConfig as Config } from "./lib/http";
import { requireUser } from "./lib/auth";
import { handle, json } from "./lib/http";
import { addDays } from "./lib/dates";
import { getActivities, summarise } from "./lib/intervals";
import { matchActivity } from "./lib/match";
import { listDays, now, putDay } from "./lib/store";

export default handle(async (req) => {
  requireUser(req);
  const today = new Date().toISOString().slice(0, 10);
  const from = addDays(today, -30);
  const pending = (await listDays()).filter((d) => d.plan && !d.matched_activity && d.date >= from && d.date <= today);
  if (pending.length === 0) return json({ checked: 0, matched: 0 });

  const oldest = pending[pending.length - 1].date;
  const { activities } = await getActivities(oldest, pending[0].date);
  const summaries = activities.map(summarise);
  const at = now();
  let matched = 0;
  for (const day of pending) {
    day.matched_activity = matchActivity(day, summaries);
    day.match_checked_at = at;
    if (day.matched_activity) {
      matched++;
      day.events.push({ at, type: "match", detail: day.matched_activity.id });
    }
    await putDay(day);
  }
  return json({ checked: pending.length, matched });
});

export const config: Config = { path: "/api/match", method: ["POST"] };
