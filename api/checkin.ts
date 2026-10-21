// POST /api/checkin {date, checkin} : stores the morning check-in and a snapshot of the metrics.
import type { RouteConfig as Config } from "./lib/http";
import { z } from "zod";
import { CheckIn, DateStr } from "../shared/schemas";
import { requireUser } from "./lib/auth";
import { handle, json, readJson } from "./lib/http";
import { loadMetrics } from "./lib/data";
import { emptyDay, getDay, now, putDay } from "./lib/store";

const Body = z.object({ date: DateStr, checkin: CheckIn });

export default handle(async (req) => {
  requireUser(req);
  const { date, checkin } = Body.parse(await readJson(req));
  const [metrics, existing] = await Promise.all([loadMetrics(date), getDay(date)]);
  const day = existing ?? emptyDay(date);
  const at = now();
  day.metrics = metrics;
  day.checkin = { ...checkin, submitted_at: at };
  day.events.push({ at, type: "checkin", detail: existing?.checkin ? "replaced earlier check-in" : null });
  await putDay(day);
  return json({ day });
});

export const config: Config = { path: "/api/checkin", method: ["POST"] };
