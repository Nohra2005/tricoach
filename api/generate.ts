// POST /api/generate {date} : starts a generation job and returns its id. The job runs
// on a queue (lib/jobs.ts, up to 15 minutes), so no request timeout can cut a model
// answer off. Poll GET /api/job?id=.
import type { RouteConfig as Config } from "./lib/http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DateStr } from "../shared/schemas";
import { requireUser } from "./lib/auth";
import { HttpError, handle, json, readJson } from "./lib/http";
import { startJob } from "./lib/jobs";
import { getDay, putJob } from "./lib/store";

const Body = z.object({ date: DateStr });

export default handle(async (req) => {
  const user = requireUser(req);
  const { date } = Body.parse(await readJson(req));
  const day = await getDay(date);
  if (!day?.checkin) throw new HttpError(409, "Submit today's check-in first");

  const id = randomUUID();
  await putJob({ id, date, status: "queued", error: null });
  try {
    await startJob({ jobId: id, date, userId: user.id });
  } catch (e) {
    const message = `Could not start generation (${e instanceof Error ? e.message : String(e)})`;
    await putJob({ id, date, status: "error", error: message });
    throw new HttpError(502, message);
  }
  return json({ jobId: id }, 202);
});

export const config: Config = { path: "/api/generate", method: ["POST"] };
