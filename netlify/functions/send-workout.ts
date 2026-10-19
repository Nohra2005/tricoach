// POST /api/send-workout {date} : puts the day's session on the intervals.icu calendar
// as a structured workout. intervals.icu sends it to Garmin Connect (when "upload planned
// workouts" is on in its Garmin settings), and the watch gets it on its next sync.
// Sending again replaces the same calendar entry (uid tricoach-YYYY-MM-DD).
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { DateStr } from "../../shared/schemas";
import { requirePasscode } from "./lib/auth";
import { HttpError, handle, json, readJson } from "./lib/http";
import { upsertWorkout } from "./lib/intervals";
import { getDay, now, putDay } from "./lib/store";
import { parsedSummary, toWorkoutText, watchType, whyNotSendable } from "./lib/workout-text";

const Body = z.object({ date: DateStr });

export default handle(async (req) => {
  requirePasscode(req);
  const { date } = Body.parse(await readJson(req));
  const day = await getDay(date);
  if (!day?.plan) throw new HttpError(409, "There is no session for this date");
  const plan = day.plan;

  const reason = whyNotSendable(plan);
  const type = watchType(plan, day.checkin);
  if (reason || !type) throw new HttpError(422, reason ?? "This session can't be sent to the watch.");

  const text = toWorkoutText(plan);
  const at = now();
  try {
    const event = await upsertWorkout({
      uid: `tricoach-${date}`,
      date,
      type,
      name: plan.title,
      description: text,
      moving_time: plan.total_minutes * 60,
      indoor: type === "VirtualRide" || (type === "Swim" && !!day.checkin?.locations.includes("pool")),
    });
    const parsed = parsedSummary(event.workout_doc);
    day.watch = {
      event_id: event.id,
      sent_at: at,
      plan_title: plan.title,
      type,
      text,
      parsed_steps: parsed.steps,
      parsed_minutes: parsed.minutes,
    };
    day.events.push({ at, type: "send_to_watch", detail: `${type}, ${parsed.steps ?? "?"} steps, event ${event.id}` });
    await putDay(day);
    return json({ day });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    day.events.push({ at, type: "send_to_watch_failed", detail: msg });
    await putDay(day);
    throw new HttpError(502, `Could not add the workout to intervals.icu: ${msg}`);
  }
});

export const config: Config = { path: "/api/send-workout", method: ["POST"] };
