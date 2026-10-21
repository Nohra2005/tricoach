// Cloudflare Worker entry. Static files (the app) are served by Workers assets without
// running this code; only /api/* reaches fetch() (wrangler.jsonc, run_worker_first).
// Each route file exports a handler and its path. queue() runs generation jobs.
import type { RouteConfig } from "./lib/http";
import { error } from "./lib/http";
import { useDatabase, type D1Like } from "./lib/db";
import { useJobQueue, type JobMessage } from "./lib/jobs";
import { runGeneration } from "./lib/generation";
import { runAs, userById, withRequest } from "./lib/users";
import * as checkin from "./checkin";
import * as deleteData from "./delete-data";
import * as feedback from "./feedback";
import * as generate from "./generate";
import * as health from "./health";
import * as history from "./history";
import * as importData from "./import";
import * as job from "./job";
import * as match from "./match";
import * as me from "./me";
import * as sendWorkout from "./send-workout";
import * as settings from "./settings";
import * as today from "./today";

interface Env {
  DB: D1Like;
  JOBS: { send(body: JobMessage): Promise<void> };
  ASSETS: { fetch(req: Request): Promise<Response> };
}
interface Message {
  body: JobMessage;
  ack(): void;
}

type Route = { default: (req: Request) => Promise<Response>; config: RouteConfig };
const ROUTES: Route[] = [checkin, deleteData, feedback, generate, health, history, importData, job, match, me, sendWorkout, settings, today];
const byPath = new Map(ROUTES.map((r) => [r.config.path, r]));

function setup(env: Env) {
  useDatabase(env.DB);
  useJobQueue((m) => env.JOBS.send(m));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    setup(env);
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const route = byPath.get(url.pathname);
    if (!route) return error(404, "Not found");
    const methods = route.config.method ?? ["GET"];
    if (!methods.includes(req.method) && !(req.method === "HEAD" && methods.includes("GET"))) {
      return error(405, `Use ${methods.join(" or ")}`);
    }
    return withRequest(() => route.default(req));
  },

  // One job per message (max_batch_size 1). A job is not retried: a failure is stored
  // on the job, and the athlete can press the button again.
  async queue(batch: { messages: Message[] }, env: Env): Promise<void> {
    setup(env);
    for (const msg of batch.messages) {
      const { jobId, date, userId } = msg.body;
      const user = userById(userId);
      if (user) await runAs(user, () => runGeneration(jobId, date));
      else console.error(`Job ${jobId}: account ${userId} no longer exists`);
      msg.ack();
    }
  },
};
