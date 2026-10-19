// POST /api/feedback {date, feedback} : stores after-session feedback and tries to
// match the completed activity from intervals.icu.
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { DateStr, Feedback } from "../../shared/schemas";
import { requirePasscode } from "./lib/auth";
import { HttpError, handle, json, readJson } from "./lib/http";
import { getActivities, summarise } from "./lib/intervals";
import { matchActivity } from "./lib/match";
import { getDay, now, putDay } from "./lib/store";

const Body = z.object({ date: DateStr, feedback: Feedback });

export default handle(async (req) => {
  requirePasscode(req);
  const { date, feedback } = Body.parse(await readJson(req));
  const day = await getDay(date);
  if (!day?.plan) throw new HttpError(409, "There is no plan for this date");

  const at = now();
  day.feedback = { ...feedback, submitted_at: at };
  day.events.push({ at, type: "feedback", detail: feedback.followed });

  let matchError: string | null = null;
  try {
    const { activities } = await getActivities(date, date);
    day.matched_activity = matchActivity(day, activities.map(summarise));
    day.match_checked_at = at;
    day.events.push({ at, type: "match", detail: day.matched_activity?.id ?? "no activity yet" });
  } catch (e) {
    matchError = e instanceof Error ? e.message : String(e);
  }
  await putDay(day);
  return json({ day, matchError });
});

export const config: Config = { path: "/api/feedback", method: ["POST"] };
