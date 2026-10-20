// POST /api/delete-data {confirm:"DELETE"} : deletes this account's check-ins, sessions,
// feedback and preferences. Nothing in intervals.icu or Garmin is touched.
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./lib/auth";
import { handle, json, readJson } from "./lib/http";
import { deleteMyData } from "./lib/store";

const Body = z.object({ confirm: z.literal("DELETE") });

export default handle(async (req) => {
  requireUser(req);
  Body.parse(await readJson(req));
  const deleted = await deleteMyData();
  return json({ deleted });
});

export const config: Config = { path: "/api/delete-data", method: ["POST"] };
