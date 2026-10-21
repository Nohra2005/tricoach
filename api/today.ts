// GET /api/today?date=YYYY-MM-DD : metrics computed from intervals.icu plus the stored day record.
import type { RouteConfig as Config } from "./lib/http";
import { requireUser } from "./lib/auth";
import { HttpError, handle, json } from "./lib/http";
import { isDate } from "./lib/dates";
import { loadMetrics } from "./lib/data";
import { emptyDay, getDay } from "./lib/store";

export default handle(async (req) => {
  requireUser(req);
  const date = new URL(req.url).searchParams.get("date");
  if (!isDate(date)) throw new HttpError(400, "date=YYYY-MM-DD is required");
  const [metrics, day] = await Promise.all([loadMetrics(date), getDay(date)]);
  return json({ metrics, day: day ?? emptyDay(date) });
});

export const config: Config = { path: "/api/today" };
