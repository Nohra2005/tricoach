// GET /api/settings, PUT /api/settings : athlete profile and plan settings.
import type { Config } from "@netlify/functions";
import { Settings } from "../../shared/schemas";
import { requireUser } from "./lib/auth";
import { handle, json, readJson } from "./lib/http";
import { getSettings, putSettings } from "./lib/store";

export default handle(async (req) => {
  requireUser(req);
  if (req.method === "PUT") {
    const s = Settings.parse(await readJson(req));
    await putSettings(s);
    return json(s);
  }
  return json(await getSettings());
});

export const config: Config = { path: "/api/settings", method: ["GET", "PUT"] };
