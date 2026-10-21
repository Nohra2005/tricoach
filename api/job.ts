// GET /api/job?id= : status of a generation job.
import type { RouteConfig as Config } from "./lib/http";
import { requireUser } from "./lib/auth";
import { HttpError, handle, json } from "./lib/http";
import { getJob } from "./lib/store";

export default handle(async (req) => {
  requireUser(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id is required");
  const job = await getJob(id);
  if (!job) throw new HttpError(404, "Unknown job");
  return json(job);
});

export const config: Config = { path: "/api/job" };
