// POST /api/generate {date} : starts a background generation job and returns its id.
// Generation runs in generate-background (15 minute limit), so the synchronous
// function timeout can never cut a model answer off. Poll GET /api/job?id=.
import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DateStr } from "../../shared/schemas";
import { DEMO_HEADER, PASSCODE_HEADER, requireUser } from "./lib/auth";
import { HttpError, handle, json, readJson } from "./lib/http";
import { getDay, putJob } from "./lib/store";

const Body = z.object({ date: DateStr });

export default handle(async (req) => {
  requireUser(req);
  const { date } = Body.parse(await readJson(req));
  const day = await getDay(date);
  if (!day?.checkin) throw new HttpError(409, "Submit today's check-in first");

  const id = randomUUID();
  await putJob({ id, date, status: "queued", error: null });
  const res = await fetch(new URL("/.netlify/functions/generate-background", req.url), {
    method: "POST",
    // Forward whichever credential this request used (passcode or demo sandbox id).
    headers: {
      "content-type": "application/json",
      ...(req.headers.get(DEMO_HEADER)
        ? { [DEMO_HEADER]: req.headers.get(DEMO_HEADER)! }
        : { [PASSCODE_HEADER]: req.headers.get(PASSCODE_HEADER) ?? "" }),
    },
    body: JSON.stringify({ jobId: id, date }),
  });
  if (res.status !== 202 && !res.ok) {
    await putJob({ id, date, status: "error", error: `Could not start generation (HTTP ${res.status})` });
    throw new HttpError(502, `Could not start generation (HTTP ${res.status})`);
  }
  return json({ jobId: id }, 202);
});

export const config: Config = { path: "/api/generate", method: ["POST"] };
