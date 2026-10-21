// POST /api/import {days, settings?} : brings in records from a TriCoach JSON export
// (Settings > Export > Export JSON), for example from the old Netlify site. Days are sent
// in small batches by the app so each request stays within the free CPU limit. A day
// that already exists here is replaced by the imported one.
import type { RouteConfig as Config } from "./lib/http";
import { z } from "zod";
import { DayRecord } from "../shared/schemas";
import { requireUser } from "./lib/auth";
import { handle, json, readJson } from "./lib/http";
import { migrateSettings } from "./lib/settings-migrate";
import { getSettings, putDay, putSettings } from "./lib/store";

export const IMPORT_BATCH = 10;
const Body = z.object({ days: z.array(z.unknown()).max(IMPORT_BATCH), settings: z.unknown().optional() });

export default handle(async (req) => {
  requireUser(req);
  const body = Body.parse(await readJson(req));
  let imported = 0;
  const skipped: string[] = [];
  for (const raw of body.days) {
    const parsed = DayRecord.safeParse(raw);
    if (!parsed.success) {
      const date = raw && typeof raw === "object" && "date" in raw ? String((raw as { date: unknown }).date) : "unknown date";
      skipped.push(date);
      continue;
    }
    await putDay(parsed.data);
    imported++;
  }
  let settings = false;
  if (body.settings !== undefined) {
    await putSettings(migrateSettings(body.settings, await getSettings()));
    settings = true;
  }
  return json({ imported, skipped, settings });
});

export const config: Config = { path: "/api/import", method: ["POST"] };
