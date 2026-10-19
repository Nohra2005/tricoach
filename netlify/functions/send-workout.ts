// POST /api/send-workout {date} : puts the day's session on the intervals.icu calendar
// as a structured workout. intervals.icu sends it to Garmin Connect (when "upload planned
// workouts" is on in its Garmin settings), and the watch gets it on its next sync.
// Sending again replaces the same calendar entry (uid tricoach-YYYY-MM-DD).
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { DateStr } from "../../shared/schemas";
import { requirePasscode } from "./lib/auth";
import { HttpError, handle, json, readJson } from "./lib/http";
import { getEvent, upsertWorkout } from "./lib/intervals";
import { getDay, now, putDay } from "./lib/store";
import { parsedSummary, toWorkoutText, watchType, whyNotSendable, type TextVariant } from "./lib/workout-text";

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

  const at = now();
  const send = (variant: TextVariant) => {
    const text = toWorkoutText(plan, variant);
    return upsertWorkout({
      uid: `tricoach-${date}`, // same uid: sending again replaces the calendar entry
      date,
      type,
      name: plan.title,
      description: text,
      moving_time: plan.total_minutes * 60,
      indoor: type === "VirtualRide" || (type === "Swim" && !!day.checkin?.locations.includes("pool")),
    }).then(async (event) => {
      // Read back the parsed steps if the create response did not include them.
      const doc = event.workout_doc ?? (await getEvent(event.id).catch(() => null))?.workout_doc;
      return { event, text, variant, parsed: parsedSummary(doc) };
    });
  };
  try {
    // If intervals.icu could not read the labelled version (no steps came back), resend
    // without labels; the same uid overwrites the first attempt.
    let r = await send("full");
    if (!r.parsed.steps) r = await send("simple");
    const ok = !!r.parsed.steps;
    day.watch = {
      event_id: r.event.id,
      sent_at: at,
      plan_title: plan.title,
      type,
      text: r.text,
      parsed_steps: r.parsed.steps,
      parsed_minutes: r.parsed.minutes,
      format: r.variant,
      parsed_ok: ok,
    };
    day.events.push({
      at,
      type: ok ? "send_to_watch" : "send_to_watch_failed",
      detail: `${type}, ${r.variant} text, ${r.parsed.steps ?? 0} steps parsed, event ${r.event.id}`,
    });
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
